import { describe, expect, test } from "bun:test"
import {
  createDocumentHistory,
  type SurfaceBridge,
} from "../../engine/doc/history"
import {
  TILE_CHANNELS,
  TILE_SIZE,
  type TileCoord,
  tileKey,
} from "../../engine/doc/tile-grid"
import { createTileStore } from "../../engine/doc/tile-store"
import { captureStructure } from "../../engine/doc/structure"
import { addLayer, createDocument } from "../../engine/doc/document"
import {
  type BlobStore,
  createMemoryBlobStore,
} from "../../engine/store/blob-store"
import { createDocumentStore } from "../../engine/store/document-store"
import { createDocumentPersistence } from "../../engine/store/local-persistence"

const TILE_VALUES = TILE_SIZE * TILE_SIZE * TILE_CHANNELS
const CANVAS = { width: TILE_SIZE * 2, height: TILE_SIZE }
const ORIGIN = { x: 0, y: 0 }
const RIGHT = { x: 1, y: 0 }

const wholeTile = (coord: TileCoord) => ({
  x: coord.x * TILE_SIZE,
  y: coord.y * TILE_SIZE,
  width: TILE_SIZE,
  height: TILE_SIZE,
})

/** A stand-in for the GPU's textures: whole tiles, by surface. */
function createFakeSurfaces() {
  const surfaces = new Map<string, Map<string, Uint16Array>>()
  const tiles = (id: string) => {
    const existing = surfaces.get(id)
    if (existing) return existing
    const created = new Map<string, Uint16Array>()
    surfaces.set(id, created)
    return created
  }
  const bridge: SurfaceBridge = {
    async readTiles(surfaceId, coords) {
      const held = tiles(surfaceId)
      return coords.map(
        (coord) =>
          held.get(tileKey(coord.x, coord.y)) ?? new Uint16Array(TILE_VALUES)
      )
    },
    writeTiles(surfaceId, writes) {
      const held = tiles(surfaceId)
      for (const write of writes) {
        const key = tileKey(write.x, write.y)
        if (write.texels) held.set(key, new Uint16Array(write.texels))
        else held.delete(key)
      }
    },
  }
  return {
    bridge,
    paint(surfaceId: string, coord: TileCoord, value: number) {
      tiles(surfaceId).set(
        tileKey(coord.x, coord.y),
        new Uint16Array(TILE_VALUES).fill(value)
      )
    },
    read(surfaceId: string, coord: TileCoord) {
      return tiles(surfaceId).get(tileKey(coord.x, coord.y)) ?? null
    },
  }
}

/**
 * One painting session: a document, its history, and a persistence that saves
 * whenever history commits. A crash is simply dropping all of this and keeping
 * the blob store, which is what `reopen` does.
 */
function session(blobs: BlobStore, documentId = "doc-1") {
  const surfaces = createFakeSurfaces()
  const doc = createDocument(CANVAS)
  const store = createTileStore({ hotBytes: 1 << 30, warmBytes: 1 << 30 })
  // The two know about each other: history commits drive the save, and the
  // save reads the index history keeps. One of the wires is late by a line.
  let commit = () => {}
  const history = createDocumentHistory({
    bridge: surfaces.bridge,
    store,
    onCommit: () => commit(),
  })
  const persistence = createDocumentPersistence({
    documentId,
    store: createDocumentStore(blobs),
    // The tiles come from the store history is already holding them in: one
    // copy of the pixels serves undo and the disk cache both.
    tiles: (hash) => store.get(hash),
    snapshot: () => ({
      ...CANVAS,
      structure: captureStructure(doc),
      surfaces: history.tileIndex(),
    }),
    onError: (error) => {
      throw error
    },
  })
  commit = () => void persistence.save()
  return {
    doc,
    store,
    surfaces,
    history,
    persistence,
    /** Paints a whole tile and lets the stroke land as one recorded step. */
    async stroke(surfaceId: string, coord: TileCoord, value: number) {
      surfaces.paint(surfaceId, coord, value)
      history.recordStroke(surfaceId, wholeTile(coord))
      await history.settle()
      await persistence.settle()
    },
  }
}

/** Everything the manifest names, written into fresh surfaces. */
async function reopen(blobs: BlobStore, documentId = "doc-1") {
  const store = createDocumentStore(blobs)
  const manifest = await store.load(documentId)
  if (!manifest) return null
  const surfaces = createFakeSurfaces()
  for (const surface of manifest.surfaces)
    surfaces.bridge.writeTiles(
      surface.surfaceId,
      await Promise.all(
        surface.tiles.map(async (tile) => ({
          x: tile.x,
          y: tile.y,
          texels: await store.readTile(tile.hash),
        }))
      )
    )
  return { manifest, surfaces }
}

describe("the blob store", () => {
  test("bytes come back exactly as they went in", async () => {
    const blobs = createMemoryBlobStore()
    await blobs.put("k", new Uint8Array([1, 2, 3]))
    expect(await blobs.get("k")).toEqual(new Uint8Array([1, 2, 3]))
    expect(await blobs.has("k")).toBe(true)
    expect(await blobs.keys()).toEqual(["k"])
  })

  test("an absent key reads as null rather than throwing", async () => {
    expect(await createMemoryBlobStore().get("nothing")).toBeNull()
  })

  test("a removed key is gone", async () => {
    const blobs = createMemoryBlobStore()
    await blobs.put("k", new Uint8Array([7]))
    await blobs.remove("k")
    expect(await blobs.has("k")).toBe(false)
  })

  test("compare-and-remove never deletes bytes that changed", async () => {
    const blobs = createMemoryBlobStore()
    await blobs.put("manifest", new Uint8Array([1]))
    expect(await blobs.compareAndRemove("manifest", new Uint8Array([2]))).toBe(
      false
    )
    expect(await blobs.get("manifest")).toEqual(new Uint8Array([1]))
    expect(await blobs.compareAndRemove("manifest", new Uint8Array([1]))).toBe(
      true
    )
    expect(await blobs.get("manifest")).toBeNull()
  })
})

describe("saving", () => {
  test("a completed stroke is on disk with no further prompting", async () => {
    const blobs = createMemoryBlobStore()
    const painting = session(blobs)
    await painting.stroke(painting.doc.activeLayerId, ORIGIN, 0x3c00)

    const stored = await reopen(blobs)
    expect(stored).not.toBeNull()
    expect(stored!.surfaces.read(painting.doc.activeLayerId, ORIGIN)).toEqual(
      painting.surfaces.read(painting.doc.activeLayerId, ORIGIN)
    )
  })

  test("tiles that did not change are not written again", async () => {
    const blobs = createMemoryBlobStore()
    const painting = session(blobs)
    const layer = painting.doc.activeLayerId
    await painting.stroke(layer, ORIGIN, 0x3c00)
    const afterFirst = (await blobs.keys()).length
    await painting.stroke(layer, RIGHT, 0x3800)
    // One new tile, and the manifest that names it: the first tile's blob is
    // already down and is addressed by content, so it is not rewritten.
    expect((await blobs.keys()).length).toBe(afterFirst + 1)
  })

  test("two surfaces holding the same pixels cost one blob", async () => {
    const blobs = createMemoryBlobStore()
    const painting = session(blobs)
    const first = painting.doc.activeLayerId
    const second = addLayer(painting.doc)
    await painting.stroke(first, ORIGIN, 0x3c00)
    await painting.stroke(second, ORIGIN, 0x3c00)
    const tiles = (await blobs.keys()).filter((key) => key.startsWith("tiles/"))
    expect(tiles.length).toBe(1)
  })

  test("the tiles on disk are the ones history is holding", async () => {
    const blobs = createMemoryBlobStore()
    const painting = session(blobs)
    await painting.stroke(painting.doc.activeLayerId, ORIGIN, 0x3c00)
    const hashes = (await blobs.keys())
      .filter((key) => key.startsWith("tiles/"))
      .map((key) => key.slice("tiles/".length))
    for (const hash of hashes)
      expect(painting.store.tier(hash)).not.toBe("absent")
  })
})

describe("reopening", () => {
  test("every layer comes back with its pixels", async () => {
    const blobs = createMemoryBlobStore()
    const painting = session(blobs)
    const first = painting.doc.activeLayerId
    const second = addLayer(painting.doc)
    await painting.stroke(first, ORIGIN, 0x3c00)
    await painting.stroke(second, RIGHT, 0x3400)

    const stored = (await reopen(blobs))!
    expect(stored.manifest.width).toBe(CANVAS.width)
    expect(stored.manifest.structure.layers.map((node) => node.id)).toEqual([
      first,
      second,
    ])
    expect(stored.surfaces.read(first, ORIGIN)).toEqual(
      painting.surfaces.read(first, ORIGIN)
    )
    expect(stored.surfaces.read(second, RIGHT)).toEqual(
      painting.surfaces.read(second, RIGHT)
    )
  })

  test("a document this device has never held reads as absent", async () => {
    expect(await reopen(createMemoryBlobStore(), "unknown")).toBeNull()
  })

  test("undoing a stroke is persisted too", async () => {
    const blobs = createMemoryBlobStore()
    const painting = session(blobs)
    const layer = painting.doc.activeLayerId
    await painting.stroke(layer, ORIGIN, 0x3c00)
    await painting.history.undo(() => {})
    await painting.persistence.settle()

    const stored = (await reopen(blobs))!
    expect(stored.surfaces.read(layer, ORIGIN)).toBeNull()
  })
})

describe("a crash mid-session", () => {
  test("work up to the last completed stroke survives", async () => {
    const blobs = createMemoryBlobStore()
    const painting = session(blobs)
    const layer = painting.doc.activeLayerId
    await painting.stroke(layer, ORIGIN, 0x3c00)
    // The pen is down again and the tab dies: the mark in flight was never a
    // completed stroke, so nothing recorded it and nothing saved it.
    painting.surfaces.paint(layer, RIGHT, 0x7000)

    const stored = (await reopen(blobs))!
    expect(stored.surfaces.read(layer, ORIGIN)).toEqual(
      painting.surfaces.read(layer, ORIGIN)
    )
    expect(stored.surfaces.read(layer, RIGHT)).toBeNull()
  })

  test("a save interrupted before its manifest leaves the last one standing", async () => {
    const blobs = createMemoryBlobStore()
    const painting = session(blobs)
    const layer = painting.doc.activeLayerId
    await painting.stroke(layer, ORIGIN, 0x3c00)
    const before = (await reopen(blobs))!

    // A device that takes the tiles and then dies before the manifest.
    const dying: BlobStore = {
      ...blobs,
      put: async (key, bytes) => {
        if (key.startsWith("documents/")) throw new Error("The tab died.")
        await blobs.put(key, bytes)
      },
    }
    const stranded = painting.store.put(
      new Uint16Array(TILE_VALUES).fill(0x3800)
    )
    const manifest = painting.persistence.manifest()
    await expect(
      createDocumentStore(dying).save(
        {
          ...manifest,
          surfaces: [
            { surfaceId: layer, tiles: [{ ...RIGHT, hash: stranded }] },
          ],
        },
        (hash) => painting.store.get(hash)
      )
    ).rejects.toThrow("The tab died.")

    const after = (await reopen(blobs))!
    // The tile is on the device and the manifest never named it: the document
    // that reopens is the one the last completed save described.
    expect(await createDocumentStore(blobs).has(stranded)).toBe(true)
    expect(after.manifest.surfaces).toEqual(before.manifest.surfaces)
  })
})

describe("a device that has lost part of what it held", () => {
  test("a tile the manifest names but the device lost reads as a hole", async () => {
    const blobs = createMemoryBlobStore()
    const painting = session(blobs)
    const layer = painting.doc.activeLayerId
    await painting.stroke(layer, ORIGIN, 0x3c00)
    await painting.stroke(layer, RIGHT, 0x3800)
    const lost = (await blobs.keys()).find((key) => key.startsWith("tiles/"))!
    await blobs.remove(lost)

    const store = createDocumentStore(blobs)
    const manifest = (await store.load("doc-1"))!
    const read = await Promise.all(
      manifest.surfaces
        .flatMap((surface) => surface.tiles)
        .map((tile) => store.readTile(tile.hash))
    )
    // One hole, and the rest of the document still opens around it.
    expect(read.filter((tile) => tile === null).length).toBe(1)
    expect(read.filter((tile) => tile !== null).length).toBe(1)
  })

  test("a half-written manifest reads as absent rather than throwing", async () => {
    const blobs = createMemoryBlobStore()
    await blobs.put(
      "documents/doc-1",
      new TextEncoder().encode('{"version":1,"id":"doc-1"')
    )
    expect(await createDocumentStore(blobs).load("doc-1")).toBeNull()
  })

  test("a manifest from a version this build cannot read is absent", async () => {
    const blobs = createMemoryBlobStore()
    await blobs.put(
      "documents/doc-1",
      new TextEncoder().encode('{"version":99,"id":"doc-1"}')
    )
    expect(await createDocumentStore(blobs).load("doc-1")).toBeNull()
  })
})
