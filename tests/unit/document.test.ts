import { describe, expect, test } from "bun:test"
import {
  addGroup,
  addLayer,
  addMask,
  cacheKey,
  compositionKey,
  createDocument,
  duplicateLayer,
  findLayer,
  findNode,
  moveLayer,
  planComposite,
  removeLayer,
  removeMask,
  resizeDocument,
  selectLayer,
  selectMask,
  setMaskEnabled,
  setLayer,
} from "../../engine/doc/document"

const document = () => createDocument({ width: 64, height: 32 })

/** Names in order, bottom to top: the order the compositor draws in. */
const order = (doc: ReturnType<typeof document>) =>
  doc.layers.map((layer) => layer.name)

describe("the layer tree", () => {
  test("starts as one raster layer holding the scene, and it is active", () => {
    const doc = document()
    expect(doc.layers).toHaveLength(1)
    expect(doc.layers[0].kind).toBe("raster")
    expect(doc.activeLayerId).toBe(doc.layers[0].id)
    // The seeded scene lives in the bottom layer's own surface.
    expect(
      findLayer(doc, doc.layers[0].id).surface.tileCount()
    ).toBeGreaterThan(0)
  })

  test("a new layer goes above the active one and becomes active", () => {
    const doc = document()
    const bottom = doc.layers[0].id
    const first = addLayer(doc)
    expect(doc.activeLayerId).toBe(first)
    expect(doc.layers.map((layer) => layer.id)).toEqual([bottom, first])
    selectLayer(doc, bottom)
    const middle = addLayer(doc)
    expect(doc.layers.map((layer) => layer.id)).toEqual([bottom, middle, first])
  })

  test("layers are named in the order they were made", () => {
    const doc = document()
    addLayer(doc)
    addLayer(doc)
    expect(order(doc)).toEqual(["Layer 1", "Layer 2", "Layer 3"])
  })

  test("duplicating a layer copies its pixels and settings into an independent layer", () => {
    const doc = document()
    const original = findLayer(doc, doc.layers[0].id)
    setLayer(doc, original.id, {
      name: "Ink",
      opacity: 0.4,
      visible: false,
      locked: true,
      blend: "multiply",
    })

    const copyId = duplicateLayer(doc, original.id)
    const copy = findLayer(doc, doc.layers[1].id)

    expect(copy).toMatchObject({
      id: copyId,
      name: "Ink copy",
      opacity: 0.4,
      visible: false,
      locked: true,
      blend: "multiply",
    })
    expect(doc.activeLayerId).toBe(copyId)
    expect(Array.from(copy.surface.readPixel(10, 10))).toEqual(
      Array.from(original.surface.readPixel(10, 10))
    )

    copy.surface.fillRect({ x: 60, y: 20, width: 1, height: 1 }, [1, 0, 0, 1])
    expect(Array.from(original.surface.readPixel(60, 20))).toEqual([0, 0, 0, 0])
  })

  test("removing the active layer selects the one under it, and the last cannot go", () => {
    const doc = document()
    const bottom = doc.layers[0].id
    const top = addLayer(doc)
    removeLayer(doc, top)
    expect(doc.activeLayerId).toBe(bottom)
    expect(() => removeLayer(doc, bottom)).toThrow(
      "A document must keep at least one layer."
    )
  })

  test("moving a layer reorders the stack without changing the selection", () => {
    const doc = document()
    const bottom = doc.layers[0].id
    addLayer(doc)
    const top = addLayer(doc)
    moveLayer(doc, top, 0)
    expect(doc.layers.map((layer) => layer.id)[0]).toBe(top)
    expect(doc.activeLayerId).toBe(top)
    moveLayer(doc, bottom, 2)
    expect(doc.layers.map((layer) => layer.id)[2]).toBe(bottom)
  })

  test("groups and groups within groups preserve sibling order", () => {
    const doc = document()
    const bottom = doc.activeLayerId
    const top = addLayer(doc)
    const inner = addGroup(doc, [bottom, top])
    expect(findNode(doc, inner)).toMatchObject({
      kind: "group",
      children: [{ id: bottom }, { id: top }],
    })
    const outer = addGroup(doc, [inner])
    expect(findNode(doc, outer)).toMatchObject({
      kind: "group",
      children: [{ id: inner, kind: "group" }],
    })
  })

  test("moves nodes into groups and refuses cycles", () => {
    const doc = document()
    const bottom = doc.activeLayerId
    const top = addLayer(doc)
    const group = addGroup(doc, [bottom])
    moveLayer(doc, top, 1, group)
    expect(findNode(doc, group)).toMatchObject({
      children: [{ id: bottom }, { id: top }],
    })
    expect(() => moveLayer(doc, group, 0, group)).toThrow(
      "A group cannot be moved inside itself."
    )
  })

  test("masks are reversible paint targets and can be removed", () => {
    const doc = document()
    const layer = findLayer(doc, doc.activeLayerId)
    const maskId = addMask(doc, layer.id)
    layer.mask!.surface.fillRect({ x: 0, y: 0, width: 1, height: 1 }, 0.5)
    expect(layer.mask!.surface.tiles()[0].texels).toHaveLength(256 * 256)
    expect(layer.mask!.surface.readPixel(0, 0)).toBeCloseTo(0.5, 3)
    selectMask(doc, layer.id)
    expect(planComposite(doc).paintTargetId).toBe(maskId)
    setMaskEnabled(doc, layer.id, false)
    expect(planComposite(doc).active?.maskId).toBeUndefined()
    expect(doc.paintingMask).toBe(false)
    expect(removeMask(doc, layer.id).id).toBe(maskId)
    expect(layer.mask).toBeUndefined()
  })

  test("rejects nonsense", () => {
    const doc = document()
    expect(() => selectLayer(doc, "nope")).toThrow("No layer nope")
    expect(() => setLayer(doc, doc.activeLayerId, { opacity: 2 })).toThrow(
      "Layer opacity must be a finite value in [0, 1]."
    )
    expect(() => moveLayer(doc, doc.activeLayerId, 4)).toThrow(
      "A layer cannot move outside the stack."
    )
  })
})

describe("the composite plan", () => {
  test("splits the stack at the active layer, bottom to top", () => {
    const doc = document()
    const bottom = doc.layers[0].id
    const middle = addLayer(doc)
    const top = addLayer(doc)
    selectLayer(doc, middle)
    const plan = planComposite(doc)
    expect(plan.below.map((item) => item.id)).toEqual([bottom])
    expect(plan.active?.id).toBe(middle)
    expect(plan.above.map((item) => item.id)).toEqual([top])
  })

  test("leaves hidden layers out of the caches and fades the active one to nothing", () => {
    const doc = document()
    const bottom = doc.layers[0].id
    const active = addLayer(doc)
    setLayer(doc, bottom, { visible: false })
    setLayer(doc, active, { visible: false, opacity: 0.5 })
    const plan = planComposite(doc)
    expect(plan.below).toEqual([])
    // Hidden is not the same as removed: the active layer is still the one
    // being painted, so it stays in the plan at no opacity.
    expect(plan.active).toEqual({
      id: active,
      opacity: 0,
      blend: "normal",
      clip: false,
    })
  })

  test("carries each layer's opacity, blend and clipping", () => {
    const doc = document()
    const bottom = doc.layers[0].id
    addLayer(doc)
    setLayer(doc, bottom, { opacity: 0.25, clip: true })
    expect(planComposite(doc).below).toEqual([
      { id: bottom, opacity: 0.25, blend: "normal", clip: true },
    ])
  })

  test("describes every group around the active layer from inside out", () => {
    const doc = document()
    const active = addLayer(doc)
    const inner = addGroup(doc, [active])
    const outer = addGroup(doc, [inner])
    setLayer(doc, inner, { opacity: 0.6, blend: "multiply" })
    setLayer(doc, outer, { visible: false })
    const plan = planComposite(doc)
    expect(plan.stages?.map((stage) => stage.container)).toEqual([
      expect.objectContaining({ id: inner, opacity: 0.6, blend: "multiply" }),
      expect.objectContaining({ id: outer, opacity: 0 }),
      null,
    ])
  })
})

describe("the composition key", () => {
  const key = (doc: ReturnType<typeof document>) =>
    compositionKey(planComposite(doc))

  test("changes on every structural change", () => {
    const doc = document()
    const bottom = doc.layers[0].id
    const top = addLayer(doc)
    const changes: [string, () => void][] = [
      ["selection", () => selectLayer(doc, bottom)],
      ["opacity", () => setLayer(doc, top, { opacity: 0.5 })],
      ["clipping", () => setLayer(doc, top, { clip: true })],
      ["order", () => moveLayer(doc, top, 0)],
      ["addition", () => addLayer(doc)],
      // Last: a hidden layer is out of the plan, so nothing after this could
      // be seen to change the composition at all.
      ["visibility", () => setLayer(doc, top, { visible: false })],
    ]
    for (const [what, change] of changes) {
      const before = key(doc)
      change()
      expect({ what, changed: key(doc) !== before }).toEqual({
        what,
        changed: true,
      })
    }
  })

  test("does not change when pixels do", () => {
    const doc = document()
    const before = key(doc)
    findLayer(doc, doc.layers[0].id).surface.fillRect(
      { x: 0, y: 0, width: 8, height: 8 },
      [1, 0, 0, 1]
    )
    // Renaming is structure the panel cares about and the compositor does not.
    setLayer(doc, doc.activeLayerId, { name: "Sky" })
    expect(key(doc)).toBe(before)
  })
})

describe("the cache key", () => {
  const caches = (doc: ReturnType<typeof document>) =>
    cacheKey(planComposite(doc))

  test("ignores what the active layer does, since it is in neither cache", () => {
    const doc = document()
    addLayer(doc)
    const before = caches(doc)
    const plan = compositionKey(planComposite(doc))
    setLayer(doc, doc.activeLayerId, { opacity: 0.3, clip: true })
    // Fading the layer under the pen is a uniform the present pass reads, not
    // two caches to flatten again — but the compositor still has to be told,
    // so the plan itself changed.
    expect(caches(doc)).toBe(before)
    expect(compositionKey(planComposite(doc))).not.toBe(plan)
  })

  test("changes when what goes into a cache does", () => {
    const doc = document()
    const bottom = doc.layers[0].id
    const top = addLayer(doc)
    const changes: [string, () => void][] = [
      ["a layer below it", () => setLayer(doc, bottom, { opacity: 0.5 })],
      ["the selection", () => selectLayer(doc, bottom)],
      ["the order", () => moveLayer(doc, top, 0)],
    ]
    for (const [what, change] of changes) {
      const before = caches(doc)
      change()
      expect({ what, changed: caches(doc) !== before }).toEqual({
        what,
        changed: true,
      })
    }
  })
})

describe("resizing", () => {
  test("keeps the stack and its settings, and re-seeds the scene", () => {
    const doc = document()
    const top = addLayer(doc)
    setLayer(doc, top, { opacity: 0.4, name: "Ink" })
    resizeDocument(doc, 128, 40)
    expect(doc.width).toBe(128)
    expect(doc.layers).toHaveLength(2)
    expect(doc.layers[1]).toMatchObject({ id: top, opacity: 0.4, name: "Ink" })
    expect(findLayer(doc, doc.layers[1].id).surface.width).toBe(128)
    expect(
      findLayer(doc, doc.layers[0].id).surface.tileCount()
    ).toBeGreaterThan(0)
    expect(doc.activeLayerId).toBe(top)
  })
})
