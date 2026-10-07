import { describe, expect, test } from "bun:test"

import { normaliseBrushDefinition } from "@/convex/lib/brush"
import { KRITA_BRUSH_SETS, KRITA_BRUSHES } from "@/engine/brush/krita-presets"
import {
  BUILTIN_BRUSHES,
  builtinBrush,
  DEFAULT_LIBRARY_BRUSH_ID,
  isBuiltinBrush,
} from "@/engine/brush/presets"
import {
  brushShelf,
  BUILTIN_SET_NAMES,
} from "@/features/studio/lib/brush-shelf"
import shipped from "@/features/studio/lib/krita-textures.json"

describe("the Krita brushes", () => {
  test("are a curated 40 to 60", () => {
    expect(KRITA_BRUSHES.length).toBeGreaterThanOrEqual(40)
    expect(KRITA_BRUSHES.length).toBeLessThanOrEqual(60)
  })

  test("come in Krita's sets, in shelf order", () => {
    expect(KRITA_BRUSH_SETS.map((set) => set.name)).toEqual([
      "Sketch",
      "Ink",
      "Paint",
      "Digital",
      "Textures",
      "FX",
    ])
    for (const set of KRITA_BRUSH_SETS)
      expect(set.brushes.length).toBeGreaterThan(0)
  })

  test("are each a brush the library would store unchanged", () => {
    for (const brush of KRITA_BRUSHES)
      expect(normaliseBrushDefinition(brush)).toEqual(brush)
  })

  test("are built-ins, with ids distinct from each other and the six", () => {
    const ids = [...BUILTIN_BRUSHES, ...KRITA_BRUSHES].map((b) => b.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(KRITA_BRUSHES.every((brush) => isBuiltinBrush(brush.id))).toBe(true)
    for (const brush of KRITA_BRUSHES)
      expect(builtinBrush(brush.id)).toBe(brush)
  })

  test("name only textures Velura ships", () => {
    const ids = new Map(shipped.textures.map((t) => [t.id, t.kind]))
    for (const brush of KRITA_BRUSHES) {
      if (brush.shape.tipTextureId)
        expect(ids.get(brush.shape.tipTextureId)).toBe("tip")
      if (brush.grain) expect(ids.get(brush.grain.textureId)).toBe("grain")
    }
  })

  test("are frozen, as the six are", () => {
    expect(Object.isFrozen(KRITA_BRUSHES[0].shape)).toBe(true)
  })
})

describe("the shelf", () => {
  test("keeps the six built-ins first and the default brush unchanged", () => {
    const shelf = brushShelf([])
    expect(shelf[0].brushes.map((entry) => entry.brush)).toEqual([
      ...BUILTIN_BRUSHES,
    ])
    expect(DEFAULT_LIBRARY_BRUSH_ID).toBe("builtin:pencil")
  })

  test("shelves the Krita sets after them, undeletable", () => {
    const shelf = brushShelf([])
    expect(shelf.slice(1).map((set) => set.name)).toEqual(
      KRITA_BRUSH_SETS.map((set) => set.name)
    )
    for (const set of shelf) {
      expect(set.builtin).toBe(true)
      for (const entry of set.brushes) expect(entry.deletable).toBe(false)
    }
  })

  test("reserves every shipped set's name", () => {
    expect(BUILTIN_SET_NAMES).toContain("Built-in")
    expect(BUILTIN_SET_NAMES).toContain("Sketch")
  })
})
