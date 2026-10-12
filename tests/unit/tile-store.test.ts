import { describe, expect, test } from "bun:test"
import {
  createInlineTileWork,
  createMemorySpill,
  createTileStore,
  hashTexels,
  type SpillDevice,
  type TileWork,
} from "../../engine/doc/tile-store"
import { TILE_CHANNELS, TILE_TEXELS } from "../../engine/doc/tile-grid"

const TILE_BYTES = TILE_TEXELS * TILE_CHANNELS * 2

/** A tile whose bytes are unique to `seed` and not trivially compressible. */
function tile(seed: number): Uint16Array {
  const texels = new Uint16Array(TILE_TEXELS * TILE_CHANNELS)
  let state = seed * 2654435761 + 1
  for (let i = 0; i < texels.length; i++) {
    state = (state * 1103515245 + 12345) >>> 0
    texels[i] = state >>> 16
  }
  return texels
}

/** Enough room for everything: tiering never runs. */
const roomy = () => createTileStore({ hotBytes: 1 << 30, warmBytes: 1 << 30 })

describe("content addressing", () => {
  test("the same pixels store once and hand back the same hash", () => {
    const store = roomy()
    const first = store.put(tile(1))
    const second = store.put(tile(1))
    expect(second).toBe(first)
    expect(store.count()).toBe(1)
  })

  test("different pixels get different hashes", () => {
    const store = roomy()
    expect(store.put(tile(1))).not.toBe(store.put(tile(2)))
    expect(store.count()).toBe(2)
  })

  test("a stored tile reads back byte for byte", async () => {
    const store = roomy()
    const hash = store.put(tile(7))
    expect(await store.get(hash)).toEqual(tile(7))
  })

  test("reading an unknown hash is an error rather than blank pixels", () => {
    const store = roomy()
    expect(store.get("nothing")).rejects.toThrow(/nothing/)
  })
})

describe("reference counting", () => {
  test("a tile survives until every reference is released", async () => {
    const store = roomy()
    const hash = store.put(tile(3))
    store.retain(hash)
    store.release(hash)
    expect(await store.get(hash)).toEqual(tile(3))
    store.release(hash)
    expect(store.count()).toBe(0)
  })

  test("re-storing released pixels starts a fresh reference", async () => {
    const store = roomy()
    const hash = store.put(tile(4))
    store.release(hash)
    expect(store.count()).toBe(0)
    expect(store.put(tile(4))).toBe(hash)
    expect(await store.get(hash)).toEqual(tile(4))
  })
})

describe("tiering", () => {
  test("recent tiles stay uncompressed and older ones compress", async () => {
    const store = createTileStore({
      hotBytes: TILE_BYTES * 2,
      warmBytes: 1 << 30,
    })
    const hashes = [1, 2, 3, 4].map((seed) => store.put(tile(seed)))
    await store.settle()
    expect(hashes.map((hash) => store.tier(hash))).toEqual([
      "warm",
      "warm",
      "hot",
      "hot",
    ])
    expect(store.residentBytes()).toBeLessThan(TILE_BYTES * 4)
  })

  test("the oldest tiles spill to disk and memory stops growing", async () => {
    const spill = createMemorySpill()
    // No compressed pool at all, so everything but the newest tile is on disk.
    const store = createTileStore({ hotBytes: TILE_BYTES, warmBytes: 0, spill })
    const hashes = []
    for (let seed = 0; seed < 8; seed++) hashes.push(store.put(tile(seed)))
    await store.settle()
    expect(store.tier(hashes[0])).toBe("cold")
    expect(store.tier(hashes.at(-1)!)).toBe("hot")
    expect(store.residentBytes()).toBeLessThanOrEqual(TILE_BYTES * 2)
    expect(spill.count()).toBeGreaterThan(0)
  })

  test("a tile restores exactly from every tier", async () => {
    const store = createTileStore({
      hotBytes: TILE_BYTES,
      warmBytes: TILE_BYTES,
      spill: createMemorySpill(),
    })
    const hashes = [0, 1, 2, 3, 4].map((seed) => store.put(tile(seed)))
    await store.settle()
    for (const [seed, hash] of hashes.entries())
      expect(await store.get(hash)).toEqual(tile(seed))
  })

  test("reading a cold tile brings it back into memory", async () => {
    const store = createTileStore({
      hotBytes: TILE_BYTES,
      warmBytes: 0,
      spill: createMemorySpill(),
    })
    const hashes = [0, 1, 2, 3, 4].map((seed) => store.put(tile(seed)))
    await store.settle()
    expect(store.tier(hashes[0])).toBe("cold")
    await store.get(hashes[0])
    expect(store.tier(hashes[0])).toBe("hot")
  })

  test("releasing a spilled tile takes it off disk too", async () => {
    const spill: SpillDevice = createMemorySpill()
    const store = createTileStore({
      hotBytes: TILE_BYTES,
      warmBytes: 0,
      spill,
    })
    const hash = store.put(tile(9))
    store.put(tile(10))
    await store.settle()
    expect(store.tier(hash)).toBe("cold")
    store.release(hash)
    await store.settle()
    expect(store.tier(hash)).toBe("absent")
    expect(spill.count()).toBe(0)
  })

  test("without a spill device tiles compress but never leave memory", async () => {
    const store = createTileStore({ hotBytes: TILE_BYTES, warmBytes: 0 })
    const hashes = [0, 1, 2].map((seed) => store.put(tile(seed)))
    await store.settle()
    expect(hashes.map((hash) => store.tier(hash))).toEqual([
      "warm",
      "warm",
      "hot",
    ])
  })
})

describe("work done elsewhere", () => {
  /** The store's own work, counting what it was asked for. */
  function counted(): TileWork & { calls: string[] } {
    const inline = createInlineTileWork()
    const calls: string[] = []
    return {
      calls,
      digest(tiles) {
        calls.push("digest")
        return inline.digest(tiles)
      },
      deflate(bytes) {
        calls.push("deflate")
        return inline.deflate(bytes)
      },
      inflate(bytes) {
        calls.push("inflate")
        return inline.inflate(bytes)
      },
      dispose() {},
    }
  }

  test("a digest names each tile's hash, and a blank tile has none", async () => {
    const store = roomy()
    const blank = new Uint16Array(TILE_TEXELS * TILE_CHANNELS)
    const { tiles, hashes } = await store.digest([tile(1), blank, tile(2)])
    expect(hashes).toEqual([
      hashTexels(tile(1)),
      undefined,
      hashTexels(tile(2)),
    ])
    expect(tiles[0]).toEqual(tile(1))
    expect(tiles[2]).toEqual(tile(2))
  })

  test("an adopted tile is the tile put would have stored", async () => {
    const store = roomy()
    const { tiles, hashes } = await store.digest([tile(5)])
    const hash = store.adopt(tiles[0], hashes[0]!)
    expect(hash).toBe(hashTexels(tile(5)))
    expect(store.put(tile(5))).toBe(hash)
    expect(store.count()).toBe(1)
    store.release(hash)
    expect(await store.get(hash)).toEqual(tile(5))
    store.release(hash)
    expect(store.count()).toBe(0)
  })

  test("adopting pixels already held takes a reference and no copy", async () => {
    const store = roomy()
    const hash = store.put(tile(6))
    expect(store.adopt(tile(6), hash)).toBe(hash)
    expect(store.count()).toBe(1)
    expect(store.residentBytes()).toBe(TILE_BYTES)
  })

  test("compressing and reading back go through the work the store was given", async () => {
    const work = counted()
    const store = createTileStore({
      hotBytes: TILE_BYTES,
      warmBytes: 1 << 30,
      work,
    })
    const old = store.put(tile(1))
    store.put(tile(2))
    await store.settle()
    expect(store.tier(old)).toBe("warm")
    expect(await store.get(old)).toEqual(tile(1))
    expect(work.calls).toContain("deflate")
    expect(work.calls).toContain("inflate")
  })
})
