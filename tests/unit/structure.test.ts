import { describe, expect, test } from "bun:test"
import {
  addGroup,
  addLayer,
  addMask,
  createDocument,
  findRasterLayer,
  removeLayer,
  setLayer,
} from "../../engine/doc/document"
import {
  adoptStrandedSurfaces,
  captureStructure,
  restoreStructure,
  sameStructure,
  savedStructure,
  structureAssets,
  structureSurfaceIds,
} from "../../engine/doc/structure"
import { makeLayerPaintable } from "../../engine/doc/document"

const document = () => createDocument({ width: 512, height: 512 })

/** The manifest observed in the field: pixels under an id no layer has. */
const stranded = () => {
  const doc = document()
  const structure = captureStructure(doc)
  const surfaces = [
    { surfaceId: doc.activeLayerId, tiles: [] },
    { surfaceId: "layer-9000", tiles: [{ x: 0, y: 0, hash: "painted" }] },
  ]
  return { doc, structure, surfaces }
}

describe("pixels no layer refers to", () => {
  test("a stored document gets a layer for them, on top, so they show", () => {
    const { doc, structure, surfaces } = stranded()
    const adopted = adoptStrandedSurfaces(structure, surfaces)
    expect(adopted.layers.map((node) => node.id)).toEqual([
      doc.activeLayerId,
      "layer-9000",
    ])
    expect(adopted.layers[1]).toMatchObject({
      kind: "raster",
      opacity: 1,
      visible: true,
      blend: "normal",
    })
    // The selection is the artist's, and recovering pixels does not move it.
    expect(adopted.activeLayerId).toBe(structure.activeLayerId)
    restoreStructure(doc, adopted)
    expect(findRasterLayer(doc, "layer-9000").kind).toBe("raster")
  })

  test("a surface that holds nothing is not a layer worth recovering", () => {
    const { structure } = stranded()
    const adopted = adoptStrandedSurfaces(structure, [
      { surfaceId: "layer-9001", tiles: [] },
    ])
    expect(adopted).toBe(structure)
  })

  test("a document with nothing stranded is left exactly as it is", () => {
    const doc = document()
    addMask(doc, doc.activeLayerId)
    const structure = captureStructure(doc)
    const surfaces = [...structureSurfaceIds(structure)].map((surfaceId) => ({
      surfaceId,
      tiles: [{ x: 0, y: 0, hash: surfaceId }],
    }))
    expect(adoptStrandedSurfaces(structure, surfaces)).toBe(structure)
    expect(savedStructure(structure, surfaces)).toBe(structure)
  })

  test("saving them fails loudly outside production", () => {
    const { structure, surfaces } = stranded()
    expect(() => savedStructure(structure, surfaces)).toThrow(/layer-9000/)
  })
})

describe("structure snapshots", () => {
  test("a snapshot carries settings and the tree but no pixels", () => {
    const doc = document()
    const structure = captureStructure(doc)
    expect(structure.layers).toHaveLength(1)
    expect(JSON.stringify(structure)).not.toContain("surface")
    expect(structure.activeLayerId).toBe(doc.activeLayerId)
  })

  test("restoring an unchanged snapshot changes nothing", () => {
    const doc = document()
    const before = captureStructure(doc)
    const surface = findRasterLayer(doc, doc.activeLayerId).surface
    restoreStructure(doc, before)
    expect(sameStructure(captureStructure(doc), before)).toBe(true)
    // The layer was not rebuilt, so its uploaded pixels are still its own.
    expect(findRasterLayer(doc, doc.activeLayerId).surface).toBe(surface)
  })

  test("restoring puts back a removed layer, its place and the selection", () => {
    const doc = document()
    const first = doc.activeLayerId
    const second = addLayer(doc)
    const before = captureStructure(doc)
    removeLayer(doc, second)
    expect(doc.activeLayerId).toBe(first)
    restoreStructure(doc, before)
    expect(doc.layers.map((node) => node.id)).toEqual([first, second])
    expect(doc.activeLayerId).toBe(second)
  })

  test("restoring undoes a grouping without disturbing the layers' pixels", () => {
    const doc = document()
    const first = doc.activeLayerId
    const surface = findRasterLayer(doc, first).surface
    const second = addLayer(doc)
    const before = captureStructure(doc)
    addGroup(doc, [first, second])
    expect(doc.layers).toHaveLength(1)
    restoreStructure(doc, before)
    expect(doc.layers.map((node) => node.id)).toEqual([first, second])
    expect(findRasterLayer(doc, first).surface).toBe(surface)
  })

  test("restoring puts settings back", () => {
    const doc = document()
    const before = captureStructure(doc)
    setLayer(doc, doc.activeLayerId, { name: "Sky", opacity: 0.25 })
    restoreStructure(doc, before)
    const layer = findRasterLayer(doc, doc.activeLayerId)
    expect(layer.name).toBe("Layer 1")
    expect(layer.opacity).toBe(1)
  })

  test("a removed mask comes back, and mask painting only when it exists", () => {
    const doc = document()
    const maskId = addMask(doc, doc.activeLayerId)
    doc.paintingMask = true
    const before = captureStructure(doc)
    delete findRasterLayer(doc, doc.activeLayerId).mask
    doc.paintingMask = false
    restoreStructure(doc, before)
    expect(findRasterLayer(doc, doc.activeLayerId).mask?.id).toBe(maskId)
    expect(doc.paintingMask).toBe(true)
  })

  test("surface ids cover nested layers and their masks", () => {
    const doc = document()
    const first = doc.activeLayerId
    const second = addLayer(doc)
    const maskId = addMask(doc, second)
    const groupId = addGroup(doc, [first, second])
    const ids = structureSurfaceIds(captureStructure(doc))
    expect([...ids].sort()).toEqual([first, maskId, second].sort())
    expect(ids.has(groupId)).toBe(false)
  })
})

describe("image layers", () => {
  test("keep their flag through a save and a restore", () => {
    const doc = document()
    const id = addLayer(doc)
    findRasterLayer(doc, id).image = true
    const structure = captureStructure(doc)
    expect(structure.layers[1]).toMatchObject({ id, image: true })
    // An ordinary layer writes nothing, so older saves compare unchanged.
    expect(structure.layers[0]).not.toHaveProperty("image")

    const restored = document()
    restoreStructure(restored, structure)
    expect(findRasterLayer(restored, id).image).toBe(true)
    expect(findRasterLayer(restored, structure.layers[0].id).image).toBe(false)
  })
})

describe("a placed image in the tree", () => {
  const placed = (id: string, x: number) => ({
    asset: { id, mime: "image/png", width: 8, height: 4 },
    placement: {
      x,
      y: 10,
      width: 8,
      height: 4,
      rotation: 0,
      flipX: false,
      flipY: false,
    },
  })

  /** A document with one image layer holding `asset`, placed at `x`. */
  function withImage(assetId = "asset-1", x = 10) {
    const doc = document()
    const id = addLayer(doc)
    const layer = findRasterLayer(doc, id)
    if (layer.kind !== "raster") throw new Error("expected a raster layer")
    layer.image = true
    layer.placed = placed(assetId, x)
    return { doc, id }
  }

  test("takes its placement into the snapshot and back out again", async () => {
    // This is what makes a transform one undo step that restores the previous
    // placement rather than the previous pixels (06).
    const { doc, id } = withImage()
    const before = captureStructure(doc)
    const layer = findRasterLayer(doc, id)
    if (layer.kind !== "raster") throw new Error("expected a raster layer")
    layer.placed = placed("asset-1", 300)

    restoreStructure(doc, before)
    const restored = findRasterLayer(doc, id)
    if (restored.kind !== "raster") throw new Error("expected a raster layer")
    expect(restored.placed?.placement.x).toBe(10)
    expect(restored.image).toBe(true)
  })

  test("names the originals a save has to keep, once each", () => {
    const { doc } = withImage()
    const second = addLayer(doc)
    const layer = findRasterLayer(doc, second)
    if (layer.kind !== "raster") throw new Error("expected a raster layer")
    layer.image = true
    // The same photograph placed twice is one original to keep.
    layer.placed = placed("asset-1", 90)
    expect(structureAssets(captureStructure(doc))).toEqual([
      { id: "asset-1", mime: "image/png", width: 8, height: 4 },
    ])
  })

  test("lets go of its original once the layer is handed to the pen", () => {
    // There is nothing left to re-render from, so keeping the file would be
    // weight in the document that nothing can ever use again.
    const { doc, id } = withImage()
    makeLayerPaintable(doc, id)
    const structure = captureStructure(doc)
    expect(structureAssets(structure)).toEqual([])
    expect(structure.layers.at(-1)?.placed).toBeUndefined()
  })

  test("is absent from a tree with no placed image, as it was before", () => {
    // Structures saved before images kept their originals read back unchanged.
    const doc = document()
    expect(captureStructure(doc).layers[0].placed).toBeUndefined()
  })
})

describe("guides in the tree (16)", () => {
  test("travel through a snapshot and back", () => {
    const doc = document()
    doc.guides = [{ id: "guide-1", axis: "x", position: 40 }]
    const structure = captureStructure(doc)
    expect(structure.guides).toEqual([
      { id: "guide-1", axis: "x", position: 40 },
    ])
    doc.guides = []
    restoreStructure(doc, structure)
    expect(doc.guides).toEqual([{ id: "guide-1", axis: "x", position: 40 }])
  })

  test("are absent from a tree with none, as it was before guides", () => {
    expect("guides" in captureStructure(document())).toBe(false)
  })

  test("a tree saved before guides existed restores with none", () => {
    const doc = document()
    const before = captureStructure(doc)
    doc.guides = [{ id: "guide-1", axis: "y", position: 3 }]
    restoreStructure(doc, before)
    expect(doc.guides).toEqual([])
  })

  test("malformed guides from a save are dropped on restore", () => {
    const doc = document()
    restoreStructure(doc, {
      ...captureStructure(doc),
      guides: [
        { id: "guide-1", axis: "x", position: 1 },
        { id: "guide-2", axis: "q", position: 2 },
      ] as never,
    })
    expect(doc.guides).toEqual([{ id: "guide-1", axis: "x", position: 1 }])
  })
})
