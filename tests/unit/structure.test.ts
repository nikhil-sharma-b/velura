import { describe, expect, test } from "bun:test"
import {
  addGroup,
  addLayer,
  addMask,
  createDocument,
  findLayer,
  removeLayer,
  setLayer,
} from "../../engine/doc/document"
import {
  captureStructure,
  restoreStructure,
  sameStructure,
  structureSurfaceIds,
} from "../../engine/doc/structure"

const document = () => createDocument({ width: 512, height: 512 })

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
    const surface = findLayer(doc, doc.activeLayerId).surface
    restoreStructure(doc, before)
    expect(sameStructure(captureStructure(doc), before)).toBe(true)
    // The layer was not rebuilt, so its uploaded pixels are still its own.
    expect(findLayer(doc, doc.activeLayerId).surface).toBe(surface)
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
    const surface = findLayer(doc, first).surface
    const second = addLayer(doc)
    const before = captureStructure(doc)
    addGroup(doc, [first, second])
    expect(doc.layers).toHaveLength(1)
    restoreStructure(doc, before)
    expect(doc.layers.map((node) => node.id)).toEqual([first, second])
    expect(findLayer(doc, first).surface).toBe(surface)
  })

  test("restoring puts settings back", () => {
    const doc = document()
    const before = captureStructure(doc)
    setLayer(doc, doc.activeLayerId, { name: "Sky", opacity: 0.25 })
    restoreStructure(doc, before)
    const layer = findLayer(doc, doc.activeLayerId)
    expect(layer.name).toBe("Layer 1")
    expect(layer.opacity).toBe(1)
  })

  test("a removed mask comes back, and mask painting only when it exists", () => {
    const doc = document()
    const maskId = addMask(doc, doc.activeLayerId)
    doc.paintingMask = true
    const before = captureStructure(doc)
    delete findLayer(doc, doc.activeLayerId).mask
    doc.paintingMask = false
    restoreStructure(doc, before)
    expect(findLayer(doc, doc.activeLayerId).mask?.id).toBe(maskId)
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
