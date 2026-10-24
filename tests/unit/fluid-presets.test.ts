import { describe, expect, test } from "bun:test"

import { normaliseBrushDefinition } from "@/convex/lib/brush"
import type { Brush } from "@/engine/brush/brush"
import { validateDynamics, type Modulator } from "@/engine/brush/dynamics"
import { KRITA_BRUSHES } from "@/engine/brush/krita-presets"
import {
  BLOT_BRUSHES,
  BUILTIN_BRUSHES,
  builtinBrush,
  FLUID_BRUSH_SET,
  FLUID_BRUSHES,
  isBuiltinBrush,
  WET_BRUSH_SET,
  WET_BRUSHES,
} from "@/engine/brush/presets"
import { BUILTIN_TEXTURE_IDS } from "@/engine/brush/texture"
import { FLUID_HOLDS, FLUID_MAX_WATER } from "@/engine/shaders/fluid"
import { brushDescription } from "@/features/studio/lib/brush-description"
import { previewStroke } from "@/features/studio/lib/brush-preview"
import {
  brushShelf,
  BUILTIN_SET_NAMES,
  duplicateOf,
  searchShelf,
} from "@/features/studio/lib/brush-shelf"
import shipped from "@/features/studio/lib/krita-textures.json"

function fluid(name: string): Brush {
  const brush = FLUID_BRUSHES.find((brush) => brush.name === name)
  if (!brush) throw new Error(`No fluid brush called ${name}.`)
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

/** Whether a brush at its set water fills a cell past what the paper holds. */
const floods = (brush: Brush) =>
  brush.rendering.fluid!.water * FLUID_MAX_WATER > FLUID_HOLDS

describe("the built-in fluid brushes", () => {
  test("are four, in a set of their own", () => {
    expect(FLUID_BRUSH_SET.brushes.slice(0, 4)).toEqual([...FLUID_BRUSHES])
    expect(FLUID_BRUSHES.map((brush) => brush.name)).toEqual([
      "Watercolour wash",
      "Watercolour detail",
      "Ink wash",
      "Water brush",
    ])
  })

  test("are each fluid, and never wet as well", () => {
    for (const brush of FLUID_BRUSHES) {
      expect(brush.rendering.fluid).toBeDefined()
      expect(brush.rendering.wet).toBeUndefined()
    }
  })

  test("are each a brush the library would store unchanged", () => {
    for (const brush of FLUID_BRUSHES) {
      expect(brush.dynamics.length).toBeGreaterThan(0)
      validateDynamics(brush.dynamics)
      expect(normaliseBrushDefinition(brush)).toEqual(brush)
    }
  })

  test("are built-ins, with ids distinct from every other shipped brush", () => {
    const ids = [
      ...BUILTIN_BRUSHES,
      ...WET_BRUSHES,
      ...FLUID_BRUSHES,
      ...BLOT_BRUSHES,
      ...KRITA_BRUSHES,
    ].map((brush) => brush.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const brush of FLUID_BRUSHES) {
      expect(isBuiltinBrush(brush.id)).toBe(true)
      expect(builtinBrush(brush.id)).toBe(brush)
    }
  })

  test("name only textures Velura ships, which its credits cover", () => {
    const kinds = new Map(shipped.textures.map((t) => [t.id, t.kind]))
    const ships = (id: string, kind: "tip" | "grain") =>
      BUILTIN_TEXTURE_IDS.includes(id) || kinds.get(id) === kind
    for (const brush of FLUID_BRUSHES) {
      if (brush.shape.tipTextureId)
        expect(ships(brush.shape.tipTextureId, "tip")).toBe(true)
      if (brush.grain) expect(ships(brush.grain.textureId, "grain")).toBe(true)
    }
  })

  test("the wash is wide and wet, and keeps the edge the brush gave it", () => {
    const wash = fluid("Watercolour wash")
    const detail = fluid("Watercolour detail")
    expect(wash.shape.radius).toBeGreaterThanOrEqual(detail.shape.radius * 3)
    expect(wash.rendering.fluid!.water).toBeGreaterThan(
      detail.rendering.fluid!.water
    )
    expect(wash.rendering.fluid!.drying).toBeLessThan(
      detail.rendering.fluid!.drying
    )
    // As wet as the paper holds and no wetter: a wash that bloomed with
    // every stroke would not stay where it was put.
    expect(floods(wash)).toBe(false)
    expect(wash.rendering.flow).toBeGreaterThan(0)
  })

  test("the detail brush is small and drier, its line set by pressure", () => {
    const brush = fluid("Watercolour detail")
    expect(brush.shape.radius).toBeLessThanOrEqual(8)
    expect(floods(brush)).toBe(false)
    expect(brush.rendering.fluid!.bleed).toBeLessThan(
      fluid("Watercolour wash").rendering.fluid!.bleed
    )
    expect(maps(brush, "pressure", "size")).toBe(true)
  })

  test("the ink wash carries more pigment than the watercolours, and does not granulate", () => {
    const brush = fluid("Ink wash")
    for (const other of [
      fluid("Watercolour wash"),
      fluid("Watercolour detail"),
    ]) {
      expect(brush.rendering.flow).toBeGreaterThan(other.rendering.flow)
      expect(brush.rendering.fluid!.granulation).toBeLessThan(
        other.rendering.fluid!.granulation
      )
    }
    expect(floods(brush)).toBe(false)
  })

  test("the water brush lays no pigment, and more water than the paper holds", () => {
    const brush = fluid("Water brush")
    expect(brush.rendering.flow).toBe(0)
    // Nothing may raise the flow off zero, or it would lay colour after all.
    expect(brush.dynamics.some((m) => m.target === "flow")).toBe(false)
    expect(floods(brush)).toBe(true)
    expect(brush.color).toBeUndefined()
  })

  test("each shows a preview stroke, the water brush's by the water it lays", () => {
    for (const brush of FLUID_BRUSHES) {
      const preview = previewStroke(brush, { width: 56, height: 40 })
      expect(preview.dabs.some((dab) => dab.opacity > 0.05)).toBe(true)
    }
  })

  test("the water brush's preview is as strong as its water", () => {
    const brush = fluid("Water brush")
    const strongest = (brush: Brush) =>
      Math.max(
        ...previewStroke(brush, { width: 56, height: 40 }).dabs.map(
          (dab) => dab.opacity
        )
      )
    const drier: Brush = {
      ...brush,
      rendering: {
        ...brush.rendering,
        fluid: { ...brush.rendering.fluid!, water: 0.25 },
      },
    }
    expect(strongest(brush)).toBeCloseTo(1)
    expect(strongest(drier)).toBeCloseTo(0.25)
  })

  test("each says what it is for under its name", () => {
    for (const brush of FLUID_BRUSHES)
      expect(brushDescription(brush.id)).not.toBe(
        brushDescription("someone's own")
      )
  })
})

describe("the shelf", () => {
  test("shelves the fluid set after the wet built-ins, undeletable", () => {
    const shelf = brushShelf([])
    expect(shelf[1].name).toBe(WET_BRUSH_SET.name)
    expect(shelf[2].name).toBe(FLUID_BRUSH_SET.name)
    expect(shelf[2].builtin).toBe(true)
    expect(shelf[2].brushes.map((entry) => entry.brush)).toEqual([
      ...FLUID_BRUSHES,
      ...BLOT_BRUSHES,
    ])
    for (const entry of shelf[2].brushes) {
      expect(entry.set).toBe(FLUID_BRUSH_SET.name)
      expect(entry.builtin).toBe(true)
      expect(entry.deletable).toBe(false)
    }
    expect(BUILTIN_SET_NAMES).toContain(FLUID_BRUSH_SET.name)
  })

  test("finds each fluid brush by name", () => {
    const shelf = brushShelf([])
    for (const brush of FLUID_BRUSHES) {
      const found = searchShelf(shelf, brush.name.toUpperCase())
      expect(
        found.flatMap((set) => set.brushes.map((entry) => entry.id))
      ).toContain(brush.id)
    }
  })

  test("duplicates one into the artist's own set, still fluid", () => {
    const entry = brushShelf([])[2].brushes[0]
    const copy = duplicateOf(entry, [])
    expect(copy.name).toBe("Watercolour wash copy")
    expect(BUILTIN_SET_NAMES).not.toContain(copy.set)
    expect(copy.brush.rendering.fluid).toEqual(entry.brush.rendering.fluid)
    expect(copy.brush).not.toBe(entry.brush)
  })
})

describe("the built-in blot brushes", () => {
  const blot = (name: string) => {
    const brush = BLOT_BRUSHES.find((brush) => brush.name === name)
    if (!brush) throw new Error(`No blot brush called ${name}.`)
    return brush
  }

  test("are a tissue and a thirsty brush, shelved after the fluid brushes", () => {
    expect(BLOT_BRUSHES.map((brush) => brush.name)).toEqual([
      "Tissue",
      "Thirsty brush",
    ])
    expect(FLUID_BRUSH_SET.brushes).toEqual([...FLUID_BRUSHES, ...BLOT_BRUSHES])
    expect(brushShelf([])[2].brushes.map((entry) => entry.brush)).toEqual([
      ...FLUID_BRUSHES,
      ...BLOT_BRUSHES,
    ])
  })

  test("are each a blot and nothing else, stored unchanged, and built-in", () => {
    const kinds = new Map(shipped.textures.map((t) => [t.id, t.kind]))
    for (const brush of BLOT_BRUSHES) {
      expect(brush.rendering.blot).toBeDefined()
      expect(brush.rendering.fluid).toBeUndefined()
      expect(brush.rendering.wet).toBeUndefined()
      expect(normaliseBrushDefinition(brush)).toEqual(brush)
      expect(builtinBrush(brush.id)).toBe(brush)
      const tip = brush.shape.tipTextureId
      if (tip)
        expect(
          BUILTIN_TEXTURE_IDS.includes(tip) || kinds.get(tip) === "tip"
        ).toBe(true)
    }
  })

  test("the tissue takes nearly all of the water and most of the pigment at once", () => {
    const tissue = blot("Tissue")
    expect(tissue.rendering.blot).toEqual({ water: 1, pigment: 0.8 })
    expect(tissue.rendering.opacity).toBe(1)
  })

  test("the thirsty brush takes water and leaves most of the pigment, as hard as it is pressed", () => {
    const thirsty = blot("Thirsty brush")
    expect(thirsty.rendering.blot).toEqual({ water: 0.7, pigment: 0.25 })
    expect(thirsty.shape.tipTextureId).toBeUndefined()
    expect(maps(thirsty, "pressure", "flow")).toBe(true)
  })
})
