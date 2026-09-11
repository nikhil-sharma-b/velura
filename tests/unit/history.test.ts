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
import {
  createMemorySpill,
  createTileStore,
  type TileStore,
} from "../../engine/doc/tile-store"
import {
  captureStructure,
  structureSurfaceIds,
} from "../../engine/doc/structure"
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

  test("a placed image's pixels arrive with the layer and leave with it", async () => {
    const fixture = setup()
    const doc = createDocument({ width: 512, height: 512 })
    const before = captureStructure(doc)
    const placed = addLayer(doc)
    fixture.history.recordOperation(
      "place image",
      { before, after: captureStructure(doc) },
      {
        filled: [
          {
            surfaceId: placed,
            tiles: [
              { ...ORIGIN, texels: new Uint16Array(TILE_VALUES).fill(7) },
            ],
          },
        ],
        canvas: { width: 512, height: 512 },
      }
    )
    await fixture.history.settle()
    // Recording is what puts the image on the surface: the caller hands over
    // texels, never writing them itself, so one step owns both halves.
    expect(fixture.read(placed, ORIGIN)![0]).toBe(7)
    expect(
      fixture.history
        .tileIndex()
        .find((surface) => surface.surfaceId === placed)!.tiles
    ).toHaveLength(1)

    await fixture.history.undo(() => {})
    expect(fixture.read(placed, ORIGIN)).toBeNull()
    await fixture.history.redo(() => {})
    expect(fixture.read(placed, ORIGIN)![0]).toBe(7)
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

describe("restoring a stored state", () => {
  /** The document as one flush left it: two painted tiles on one surface. */
  function paintedDocument() {
    const surfaces = createFakeSurfaces()
    const history = createDocumentHistory({ bridge: surfaces.bridge })
    const document = createDocument(CANVAS)
    const structure = captureStructure(document)
    const surfaceId = structure.layers[0]!.id
    return { surfaces, history, document, structure, surfaceId }
  }

  const filled = (value: number) => new Uint16Array(TILE_VALUES).fill(value)

  test("a replacement puts back the stored pixels and drops what came after", async () => {
    const { surfaces, history, structure, surfaceId } = paintedDocument()
    // The stored state: tile (0,0) only.
    history.recordUpload(
      surfaceId,
      [{ x: 0, y: 0, texels: filled(11) }],
      CANVAS
    )
    surfaces.paint(surfaceId, { x: 0, y: 0 }, 11)
    // A later session paints over it and adds a tile the stored state lacks.
    surfaces.paint(surfaceId, { x: 0, y: 0 }, 22)
    surfaces.paint(surfaceId, { x: 1, y: 0 }, 33)
    history.recordStroke(surfaceId, {
      x: 0,
      y: 0,
      width: TILE_SIZE * 2,
      height: TILE_SIZE,
    })
    await history.settle()

    history.recordReplacement(
      "restore",
      { before: structure, after: structure },
      [{ surfaceId, tiles: [{ x: 0, y: 0, texels: filled(11) }] }],
      CANVAS
    )
    await history.settle()

    expect(surfaces.read(surfaceId, { x: 0, y: 0 })).toEqual(filled(11))
    // The tile the stored state never had is gone, not left painted.
    expect(surfaces.read(surfaceId, { x: 1, y: 0 })).toBeNull()
  })

  test("the restore is one undo step, so the artist can take it back", async () => {
    const { surfaces, history, structure, surfaceId } = paintedDocument()
    history.recordUpload(
      surfaceId,
      [{ x: 0, y: 0, texels: filled(11) }],
      CANVAS
    )
    surfaces.paint(surfaceId, { x: 0, y: 0 }, 22)
    history.recordStroke(surfaceId, wholeTile({ x: 0, y: 0 }))
    await history.settle()
    const stepsBefore = history.stepsBack()

    history.recordReplacement(
      "restore",
      { before: structure, after: structure },
      [{ surfaceId, tiles: [{ x: 0, y: 0, texels: filled(11) }] }],
      CANVAS
    )
    await history.settle()
    expect(history.stepsBack()).toBe(stepsBefore + 1)

    expect(await history.undo(() => {})).toBe(true)

    // Back to the work the restore covered, not to the state it restored.
    expect(surfaces.read(surfaceId, { x: 0, y: 0 })).toEqual(filled(22))
    expect(await history.redo(() => {})).toBe(true)
    expect(surfaces.read(surfaceId, { x: 0, y: 0 })).toEqual(filled(11))
  })

  test("the tile index follows the restore, so the next save writes it", async () => {
    const { surfaces, history, structure, surfaceId } = paintedDocument()
    surfaces.paint(surfaceId, { x: 1, y: 0 }, 33)
    history.recordUpload(
      surfaceId,
      [{ x: 1, y: 0, texels: filled(33) }],
      CANVAS
    )
    await history.settle()

    history.recordReplacement(
      "restore",
      { before: structure, after: structure },
      [{ surfaceId, tiles: [{ x: 0, y: 0, texels: filled(11) }] }],
      CANVAS
    )
    await history.settle()

    const index = history.tileIndex().find((s) => s.surfaceId === surfaceId)
    expect(index?.tiles.map((tile) => ({ x: tile.x, y: tile.y }))).toEqual([
      { x: 0, y: 0 },
    ])
  })

  test("a surface the stored state never had is emptied", async () => {
    const { surfaces, history, document, structure } = paintedDocument()
    const kept = structure.layers[0]!.id
    const added = addLayer(document)
    surfaces.paint(added, { x: 0, y: 0 }, 44)
    history.recordUpload(added, [{ x: 0, y: 0, texels: filled(44) }], CANVAS)
    await history.settle()

    history.recordReplacement(
      "restore",
      { before: captureStructure(document), after: structure },
      [{ surfaceId: kept, tiles: [{ x: 0, y: 0, texels: filled(11) }] }],
      CANVAS
    )
    await history.settle()

    expect(surfaces.read(added, { x: 0, y: 0 })).toBeNull()
    expect(
      history.tileIndex().find((s) => s.surfaceId === added)
    ).toBeUndefined()
  })

  test("restoring the state the document is already in is not a step", async () => {
    const { surfaces, history, structure, surfaceId } = paintedDocument()
    surfaces.paint(surfaceId, { x: 0, y: 0 }, 11)
    history.recordUpload(
      surfaceId,
      [{ x: 0, y: 0, texels: filled(11) }],
      CANVAS
    )
    await history.settle()
    const stepsBefore = history.stepsBack()

    history.recordReplacement(
      "restore",
      { before: structure, after: structure },
      [{ surfaceId, tiles: [{ x: 0, y: 0, texels: filled(11) }] }],
      CANVAS
    )
    await history.settle()

    expect(history.stepsBack()).toBe(stepsBefore)
  })
})

describe("undo racing a stroke", () => {
  test("a stroke that lands while undo waits on the store is what undo takes back", async () => {
    // The store's own settling is the last thing undo waits on. Whatever is
    // handed to this runs inside that wait, after the recording queue was
    // last seen empty.
    let duringSettle: (() => void) | undefined
    const inner = createTileStore({
      hotBytes: TILE_BYTES * 2,
      warmBytes: 64 * 1024,
      spill: createMemorySpill(),
    })
    const store: TileStore = {
      ...inner,
      async settle() {
        await inner.settle()
        const landed = duringSettle
        duringSettle = undefined
        landed?.()
      },
    }
    const surfaces = createFakeSurfaces()
    const history = createDocumentHistory({
      bridge: {
        ...surfaces.bridge,
        // A GPU readback is a real wait, not a resolved promise: the pixels
        // come back on a later task, which is the window the race needs.
        async readTiles(surfaceId, coords) {
          await new Promise((resolve) => setTimeout(resolve, 0))
          return surfaces.bridge.readTiles(surfaceId, coords)
        },
      },
      store,
    })
    const doc = createDocument({ width: 512, height: 512 })
    const before = captureStructure(doc)
    const added = addLayer(doc)
    history.recordOperation("add layer", {
      before,
      after: captureStructure(doc),
    })
    await history.settle()

    // The pen lifts on the new layer as the artist reaches for undo: the
    // stroke's readback is queued while undo is still settling.
    surfaces.paint(added, ORIGIN, 5)
    duringSettle = () => history.recordStroke(added, wholeTile(ORIGIN))
    let structure = captureStructure(doc)
    await history.undo((restored) => {
      structure = restored
    })
    await history.settle()

    // Undo took back the stroke, not the layer it was painted on.
    expect(structureSurfaceIds(structure).has(added)).toBe(true)
    expect(surfaces.read(added, ORIGIN)).toBeNull()
    // So no surface with pixels is left that the tree does not name, which is
    // the manifest a reopened document would have shown blank.
    const named = structureSurfaceIds(structure)
    expect(
      history
        .tileIndex()
        .filter((surface) => surface.tiles.length > 0)
        .filter((surface) => !named.has(surface.surfaceId))
    ).toEqual([])
    expect(history.canUndo()).toBe(true)
  })

  test("recording still queued when history is cleared does not outlive it", async () => {
    // A document replaced by a stored one: the canvas it opened on was queued
    // for recording, and clearing happens before that queue has run.
    const { history } = setup()
    history.recordUpload(
      "seeded",
      [{ ...ORIGIN, texels: new Uint16Array(TILE_VALUES).fill(3) }],
      CANVAS
    )
    history.clear()
    await history.settle()
    expect(history.tileIndex()).toEqual([])
  })
})
