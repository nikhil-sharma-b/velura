import { describe, expect, test } from "bun:test"

import { normaliseBrushDefinition } from "@/convex/lib/brush"
import type { Brush } from "@/engine/brush/brush"
import { validateDynamics, type Modulator } from "@/engine/brush/dynamics"
import { KRITA_BRUSHES } from "@/engine/brush/krita-presets"
import {
  BUILTIN_BRUSHES,
  builtinBrush,
  isBuiltinBrush,
  WET_BRUSH_SET,
  WET_BRUSHES,
} from "@/engine/brush/presets"
import { BUILTIN_TEXTURE_IDS } from "@/engine/brush/texture"
import { brushDescription } from "@/features/studio/lib/brush-description"
import { previewStroke } from "@/features/studio/lib/brush-preview"
import {
  brushShelf,
  BUILTIN_SET,
  BUILTIN_SET_NAMES,
  duplicateOf,
  FOLDED_SET_NAMES,
  searchShelf,
} from "@/features/studio/lib/brush-shelf"
import shipped from "@/features/studio/lib/krita-textures.json"

function wet(name: string): Brush {
  const brush = WET_BRUSHES.find((brush) => brush.name === name)
  if (!brush) throw new Error(`No wet brush called ${name}.`)
  return brush
}

function maps(
  brush: Brush,
  source: Modulator["source"],
  target: Modulator["target"]
): boolean {
  return brush.dynamics.some(
    (modulator) => modulator.source === source && modulator.target === target
  )
}

describe("the built-in wet brushes", () => {
  test("are four, in a set of their own", () => {
    expect(WET_BRUSH_SET.brushes).toBe(WET_BRUSHES)
    expect(WET_BRUSHES.map((brush) => brush.name)).toEqual([
      "Oil round",
      "Oil flat",
      "Blender",
      "Dry bristle",
    ])
  })

  test("are each wet, with nothing a wet dab would ignore", () => {
    for (const brush of WET_BRUSHES) {
      expect(brush.rendering.wet).toBeDefined()
      // Scatter and colour jitter do not reach a wet dab (live brushes 12, 13).
      expect(brush.scatter).toBeUndefined()
      expect(brush.color).toBeUndefined()
    }
  })

  test("are each a brush the library would store unchanged", () => {
    for (const brush of WET_BRUSHES) {
      expect(brush.dynamics.length).toBeGreaterThan(0)
      validateDynamics(brush.dynamics)
      expect(normaliseBrushDefinition(brush)).toEqual(brush)
    }
  })

  test("are built-ins, with ids distinct from every other shipped brush", () => {
    const ids = [...BUILTIN_BRUSHES, ...WET_BRUSHES, ...KRITA_BRUSHES].map(
      (brush) => brush.id
    )
    expect(new Set(ids).size).toBe(ids.length)
    for (const brush of WET_BRUSHES) {
      expect(isBuiltinBrush(brush.id)).toBe(true)
      expect(builtinBrush(brush.id)).toBe(brush)
    }
  })

  test("name only textures Velura ships, which its credits cover", () => {
    const kinds = new Map(shipped.textures.map((t) => [t.id, t.kind]))
    const ships = (id: string, kind: "tip" | "grain") =>
      BUILTIN_TEXTURE_IDS.includes(id) || kinds.get(id) === kind
    for (const brush of WET_BRUSHES) {
      if (brush.shape.tipTextureId)
        expect(ships(brush.shape.tipTextureId, "tip")).toBe(true)
      if (brush.grain) expect(ships(brush.grain.textureId, "grain")).toBe(true)
    }
  })

  test("the oil round is a soft round that covers, loaded by pressure", () => {
    const brush = wet("Oil round")
    expect(brush.shape.tipTextureId).toBeUndefined()
    expect(brush.shape.roundness).toBe(1)
    expect(brush.shape.feather).toBeGreaterThan(1)
    expect(brush.rendering.flow).toBeGreaterThanOrEqual(0.7)
    expect(brush.rendering.wet!.pickup).toBeGreaterThan(0)
    expect(maps(brush, "pressure", "flow")).toBe(true)
  })

  test("the oil flat is a bristle tip turned to follow the stroke", () => {
    const brush = wet("Oil flat")
    expect(brush.shape.tipTextureId).toMatch(/bristle/)
    expect(brush.rendering.flow).toBeGreaterThanOrEqual(0.5)
    expect(maps(brush, "direction", "angle")).toBe(true)
  })

  test("the blender lays nothing and blends by pressure", () => {
    const brush = wet("Blender")
    expect(brush.rendering.flow).toBe(0)
    expect(brush.rendering.wet!.pickup).toBeGreaterThan(0.5)
    expect(maps(brush, "pressure", "pickup")).toBe(true)
    // Nothing may raise the flow off zero, or it would lay colour after all.
    expect(brush.dynamics.some((m) => m.target === "flow")).toBe(false)
  })

  test("the dry bristle lays less and picks up more than the oils, on a tooth", () => {
    const brush = wet("Dry bristle")
    expect(brush.shape.tipTextureId).toMatch(/bristle/)
    expect(brush.rendering.flow).toBeGreaterThan(0)
    expect(brush.grain?.depth).toBeGreaterThan(0)
    for (const oil of [wet("Oil round"), wet("Oil flat")]) {
      expect(brush.rendering.flow).toBeLessThan(oil.rendering.flow / 2 + 0.01)
      expect(brush.rendering.wet!.pickup).toBeGreaterThanOrEqual(
        oil.rendering.wet!.pickup * 3
      )
    }
  })

  test("each shows a preview stroke, the blender's by what it would drag", () => {
    for (const brush of WET_BRUSHES) {
      const preview = previewStroke(brush, { width: 56, height: 40 })
      expect(preview.dabs.some((dab) => dab.opacity > 0.05)).toBe(true)
    }
  })

  test("each says what it is for under its name", () => {
    for (const brush of WET_BRUSHES)
      expect(brushDescription(brush.id)).not.toBe(
        brushDescription("someone's own")
      )
  })
})

describe("the shelf", () => {
  test("shelves the wet set after the built-ins, undeletable", () => {
    const shelf = brushShelf([])
    expect(shelf[0].name).toBe(BUILTIN_SET)
    expect(shelf[1].name).toBe(WET_BRUSH_SET.name)
    expect(shelf[1].builtin).toBe(true)
    expect(shelf[1].brushes.map((entry) => entry.brush)).toEqual([
      ...WET_BRUSHES,
    ])
    for (const entry of shelf[1].brushes) {
      expect(entry.set).toBe(WET_BRUSH_SET.name)
      expect(entry.builtin).toBe(true)
      expect(entry.deletable).toBe(false)
    }
    expect(BUILTIN_SET_NAMES).toContain(WET_BRUSH_SET.name)
    // Four rows are not a wall: the set opens unfolded, unlike Krita's.
    expect(FOLDED_SET_NAMES).not.toContain(WET_BRUSH_SET.name)
    expect(FOLDED_SET_NAMES).toContain("Sketch")
  })

  test("finds each wet brush by name", () => {
    const shelf = brushShelf([])
    for (const brush of WET_BRUSHES) {
      const found = searchShelf(shelf, brush.name.toUpperCase())
      expect(
        found.flatMap((set) => set.brushes.map((entry) => entry.id))
      ).toContain(brush.id)
    }
  })

  test("duplicates one into the artist's own set, still wet", () => {
    const entry = brushShelf([])[1].brushes[0]
    const copy = duplicateOf(entry, [])
    expect(copy.name).toBe("Oil round copy")
    expect(BUILTIN_SET_NAMES).not.toContain(copy.set)
    expect(copy.brush.rendering.wet).toEqual(entry.brush.rendering.wet)
    expect(copy.brush).not.toBe(entry.brush)
  })
})
