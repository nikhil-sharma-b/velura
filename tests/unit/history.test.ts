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
import { createMemorySpill, createTileStore } from "../../engine/doc/tile-store"
import { captureStructure } from "../../engine/doc/structure"
import {
  addLayer,
  createDocument,
  removeLayer,
  setLayer,
} from "../../engine/doc/document"

const TILE_VALUES = TILE_SIZE * TILE_SIZE * TILE_CHANNELS
const TILE_BYTES = TILE_VALUES * 2
const CANVAS = { width: TILE_SIZE * 2, height: TILE_SIZE }

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
    /** Paints a recognisable value across one whole tile. */
    paint(surfaceId: string, coord: TileCoord, value: number) {
      const texels = new Uint16Array(TILE_VALUES).fill(value)
      tiles(surfaceId).set(tileKey(coord.x, coord.y), texels)
    },
    read(surfaceId: string, coord: TileCoord) {
      return tiles(surfaceId).get(tileKey(coord.x, coord.y)) ?? null
    },
  }
}

const wholeTile = (coord: TileCoord) => ({
  x: coord.x * TILE_SIZE,
  y: coord.y * TILE_SIZE,
  width: TILE_SIZE,
  height: TILE_SIZE,
})

const ORIGIN = { x: 0, y: 0 }

function setup(budgetBytes?: number) {
  const surfaces = createFakeSurfaces()
  const history = createDocumentHistory({
    bridge: surfaces.bridge,
    budgetBytes,
    // Deflated tiles are a fraction of a raw one, so the compressed pool is
    // sized in its own terms: small enough that a short session reaches disk.
    store: createTileStore({
      hotBytes: TILE_BYTES * 2,
      warmBytes: 64 * 1024,
      spill: createMemorySpill(),
    }),
  })
  return { ...surfaces, history }
}

/** One stroke over one tile, as the engine records it on pen-up. */
async function stroke(
  fixture: ReturnType<typeof setup>,
  value: number,
  coord: TileCoord = ORIGIN,
  surfaceId = "layer"
) {
  fixture.paint(surfaceId, coord, value)
  fixture.history.recordStroke(surfaceId, wholeTile(coord))
  await fixture.history.settle()
}

const noStructure = () => {
  throw new Error("This step should not have restored a structure.")
}

describe("recording strokes", () => {
  test("nothing to undo before anything is painted", () => {
    const { history } = setup()
    expect(history.canUndo()).toBe(false)
  })

  test("one stroke is one step, and undoing it restores the pixels", async () => {
    const fixture = setup()
    await stroke(fixture, 1)
    await stroke(fixture, 2)
    expect(fixture.history.depth()).toBe(2)

    await fixture.history.undo(noStructure)
    expect(fixture.read("layer", ORIGIN)![0]).toBe(1)
    await fixture.history.undo(noStructure)
    // Before the first stroke the tile held nothing at all.
    expect(fixture.read("layer", ORIGIN)).toBeNull()
    expect(fixture.history.canUndo()).toBe(false)
  })

  test("redo puts the stroke back", async () => {
    const fixture = setup()
    await stroke(fixture, 1)
    await stroke(fixture, 2)
    await fixture.history.undo(noStructure)
    await fixture.history.undo(noStructure)
    expect(fixture.history.canRedo()).toBe(true)
    await fixture.history.redo(noStructure)
    expect(fixture.read("layer", ORIGIN)![0]).toBe(1)
    await fixture.history.redo(noStructure)
    expect(fixture.read("layer", ORIGIN)![0]).toBe(2)
    expect(fixture.history.canRedo()).toBe(false)
  })

  test("a stroke that changed nothing is not a step", async () => {
    const fixture = setup()
    await stroke(fixture, 1)
    fixture.history.recordStroke("layer", wholeTile(ORIGIN))
    await fixture.history.settle()
    expect(fixture.history.depth()).toBe(1)
  })

  test("only the tiles the mark touched are held", async () => {
    const fixture = setup()
    await stroke(fixture, 1, ORIGIN)
    await stroke(fixture, 1, { x: 1, y: 0 })
    // Identical pixels in two tiles are one stored tile (content addressing).
    expect(fixture.history.bytes()).toBe(TILE_BYTES)
  })

  test("uploaded pixels are what the first stroke is measured against", async () => {
    const fixture = setup()
    const seeded = new Uint16Array(TILE_VALUES).fill(7)
    fixture.bridge.writeTiles("layer", [{ ...ORIGIN, texels: seeded }])
    fixture.history.recordUpload(
      "layer",
      [{ ...ORIGIN, texels: seeded }],
      CANVAS
    )
    await stroke(fixture, 9)
    await fixture.history.undo(noStructure)
    expect(fixture.read("layer", ORIGIN)![0]).toBe(7)
  })

  test("painting after an undo drops what was undone", async () => {
    const fixture = setup()
    await stroke(fixture, 1)
    await stroke(fixture, 2)
    await fixture.history.undo(noStructure)
    await stroke(fixture, 3)
    expect(fixture.history.canRedo()).toBe(false)
    await fixture.history.undo(noStructure)
    expect(fixture.read("layer", ORIGIN)![0]).toBe(1)
  })
})

describe("recording layer operations", () => {
  test("an operation restores the tree it was performed on", async () => {
    const { history } = setup()
    const doc = createDocument({ width: 512, height: 512 })
    const before = captureStructure(doc)
    const added = addLayer(doc)
    history.recordOperation("add layer", {
      before,
      after: captureStructure(doc),
    })
    await history.settle()
    let restored: string[] = []
    await history.undo((structure) => {
      restored = structure.layers.map((node) => node.id)
    })
    expect(restored).not.toContain(added)
    await history.redo((structure) => {
      restored = structure.layers.map((node) => node.id)
    })
    expect(restored).toContain(added)
  })

  test("a removed layer's pixels come back with it", async () => {
    const fixture = setup()
    const doc = createDocument({ width: 512, height: 512 })
    const removable = addLayer(doc)
    fixture.paint(removable, ORIGIN, 5)
    fixture.history.recordStroke(removable, wholeTile(ORIGIN))
    await fixture.history.settle()

    const before = captureStructure(doc)
    removeLayer(doc, removable)
    fixture.bridge.writeTiles(removable, [{ ...ORIGIN, texels: null }])
    fixture.history.recordOperation(
      "remove layer",
      { before, after: captureStructure(doc) },
      { removed: [removable] }
    )
    await fixture.history.settle()
    expect(fixture.read(removable, ORIGIN)).toBeNull()

    await fixture.history.undo(() => {})
    expect(fixture.read(removable, ORIGIN)![0]).toBe(5)
    await fixture.history.redo(() => {})
    expect(fixture.read(removable, ORIGIN)).toBeNull()
  })

  test("an operation that changed nothing is not a step", async () => {
    const { history } = setup()
    const doc = createDocument({ width: 512, height: 512 })
    const before = captureStructure(doc)
    history.recordOperation("layer settings", {
      before,
      after: captureStructure(doc),
    })
    await history.settle()
    expect(history.canUndo()).toBe(false)
  })

  test("a run of adjustments to one setting is one step", async () => {
    const { history } = setup()
    const doc = createDocument({ width: 512, height: 512 })
    const start = captureStructure(doc)
    // What a dragged opacity slider sends: a command per tick.
    for (const opacity of [0.8, 0.6, 0.4, 0.2]) {
      const before = captureStructure(doc)
      setLayer(doc, doc.activeLayerId, { opacity })
      history.recordOperation(
        "layer settings",
        { before, after: captureStructure(doc) },
        { coalesceAs: `${doc.activeLayerId}:opacity` }
      )
    }
    await history.settle()
    expect(history.depth()).toBe(1)

    let restored = start
    await history.undo((structure) => {
      restored = structure
    })
    // One undo lands where the drag started, not one tick back into it.
    expect(restored.layers[0].opacity).toBe(1)
    await history.redo((structure) => {
      restored = structure
    })
    expect(restored.layers[0].opacity).toBe(0.2)
  })

  test("a different setting starts a step of its own", async () => {
    const { history } = setup()
    const doc = createDocument({ width: 512, height: 512 })
    for (const patch of [{ opacity: 0.5 }, { name: "Sky" }]) {
      const before = captureStructure(doc)
      setLayer(doc, doc.activeLayerId, patch)
      history.recordOperation(
        "layer settings",
        { before, after: captureStructure(doc) },
        {
          coalesceAs: `${doc.activeLayerId}:${Object.keys(patch).join(",")}`,
        }
      )
    }
    await history.settle()
    expect(history.depth()).toBe(2)
  })

  test("a duplicate shares the original's stored tiles", async () => {
    const fixture = setup()
    await stroke(fixture, 4)
    const doc = createDocument({ width: 512, height: 512 })
    const before = captureStructure(doc)
    const held = fixture.history.bytes()
    fixture.history.recordOperation(
      "duplicate layer",
      { before, after: captureStructure(doc) },
      { copied: [{ from: "layer", to: "copy" }] }
    )
    await fixture.history.settle()
    expect(fixture.history.bytes()).toBe(held)
    await fixture.history.undo(() => {})
    expect(fixture.read("copy", ORIGIN)).toBeNull()
    await fixture.history.redo(() => {})
    expect(fixture.read("copy", ORIGIN)![0]).toBe(4)
  })
})

describe("a long session", () => {
  test("crosses the tiers and still restores pixels exactly", async () => {
    const fixture = setup()
    const values = Array.from({ length: 40 }, (_, step) => step + 1)
    for (const value of values) await stroke(fixture, value)
    await fixture.history.settle()
    // Memory holds a slice of the history: the rest is compressed, and the
    // oldest of it has left memory for the spill device entirely.
    expect(fixture.history.residentBytes()).toBeLessThan(
      fixture.history.bytes()
    )
    expect(fixture.history.spilledBytes()).toBeGreaterThan(0)
    for (const value of values.slice().reverse()) {
      expect(fixture.read("layer", ORIGIN)![0]).toBe(value)
      await fixture.history.undo(noStructure)
    }
    expect(fixture.read("layer", ORIGIN)).toBeNull()
  })

  test("history stops growing once it is over budget", async () => {
    const fixture = setup(TILE_BYTES * 4)
    for (let value = 1; value <= 30; value++) await stroke(fixture, value)
    await fixture.history.settle()
    expect(fixture.history.bytes()).toBeLessThanOrEqual(TILE_BYTES * 4)
    expect(fixture.history.depth()).toBeGreaterThan(1)
    // The steps that remain still undo exactly.
    await fixture.history.undo(noStructure)
    expect(fixture.read("layer", ORIGIN)![0]).toBe(29)
  })

  test("clearing lets go of every tile it was holding", async () => {
    const fixture = setup()
    for (let value = 1; value <= 5; value++) await stroke(fixture, value)
    fixture.history.clear()
    expect(fixture.history.canUndo()).toBe(false)
    expect(fixture.history.bytes()).toBe(0)
    expect(fixture.history.store.count()).toBe(0)
  })
})
