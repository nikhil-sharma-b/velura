import { describe, expect, test } from "bun:test"

import { validateDynamics } from "@/engine/brush/dynamics"
import {
  BUILTIN_BRUSHES,
  builtinBrush,
  DEFAULT_LIBRARY_BRUSH_ID,
  isBuiltinBrush,
} from "@/engine/brush/presets"
import { BUILTIN_TEXTURE_IDS } from "@/engine/brush/texture"
import {
  DEFAULT_BRUSH_SET,
  MAX_TEXTURE_DIMENSION,
  normaliseBrushDefinition,
  normaliseBrushName,
  normaliseSetName,
  normaliseStoredTexture,
  reorderBrushes,
} from "@/convex/lib/brush"

describe("built-in brushes", () => {
  test("cover common media and are all distinct", () => {
    const ids = BUILTIN_BRUSHES.map((brush) => brush.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.length).toBeGreaterThanOrEqual(5)
    expect(BUILTIN_BRUSHES.every((brush) => isBuiltinBrush(brush.id))).toBe(true)
    expect(builtinBrush(DEFAULT_LIBRARY_BRUSH_ID)).toBeDefined()
  })

  test("every one drives the dynamics graph rather than being a flat preset", () => {
    for (const brush of BUILTIN_BRUSHES) {
      expect(brush.dynamics.length).toBeGreaterThan(0)
      // What the engine would accept, checked here so a bad preset fails a
      // unit test rather than a stroke.
      validateDynamics(brush.dynamics)
      normaliseBrushDefinition(brush)
    }
  })

  test("only name textures every install has", () => {
    for (const brush of BUILTIN_BRUSHES) {
      if (brush.shape.tipTextureId)
        expect(BUILTIN_TEXTURE_IDS).toContain(brush.shape.tipTextureId)
      if (brush.grain) expect(BUILTIN_TEXTURE_IDS).toContain(brush.grain.textureId)
    }
  })
})

describe("names", () => {
  test("collapse whitespace and fall back to something readable", () => {
    expect(normaliseBrushName("  Soft   pencil ")).toBe("Soft pencil")
    expect(normaliseBrushName("   ")).not.toBe("")
    expect(normaliseSetName("")).toBe(DEFAULT_BRUSH_SET)
    expect(normaliseBrushName("x".repeat(500)).length).toBeLessThanOrEqual(120)
  })
})

describe("a stored brush definition", () => {
  const round = builtinBrush(DEFAULT_LIBRARY_BRUSH_ID)!

  test("round-trips through JSON unchanged", () => {
    const stored = normaliseBrushDefinition(JSON.parse(JSON.stringify(round)))
    expect(stored).toEqual(round)
  })

  test("drops anything the model has no field for", () => {
    const stored = normaliseBrushDefinition({
      ...round,
      shape: { ...round.shape, nonsense: 3 },
      trailing: "code",
    })
    expect(stored).not.toHaveProperty("trailing")
    expect(stored.shape).not.toHaveProperty("nonsense")
  })

  test("refuses values the engine would throw on", () => {
    expect(() =>
      normaliseBrushDefinition({ ...round, shape: { ...round.shape, radius: 0 } })
    ).toThrow()
    expect(() =>
      normaliseBrushDefinition({
        ...round,
        rendering: { ...round.rendering, opacity: 4 },
      })
    ).toThrow()
    expect(() =>
      normaliseBrushDefinition({
        ...round,
        dynamics: [{ source: "pressure", target: "angle", range: [0, 1], mix: "multiply" }],
      })
    ).toThrow()
    expect(() => normaliseBrushDefinition(null)).toThrow()
  })
})

describe("reordering", () => {
  const brushes = [
    { id: "a", set: "Inks", order: 0 },
    { id: "b", set: "Inks", order: 1 },
    { id: "c", set: "Inks", order: 2 },
    { id: "d", set: "Pencils", order: 0 },
  ]

  test("moves a brush within its set and renumbers only what moved", () => {
    const changes = reorderBrushes(brushes, "c", "Inks", 0)
    expect(changes).toEqual([
      { id: "c", set: "Inks", order: 0 },
      { id: "a", set: "Inks", order: 1 },
      { id: "b", set: "Inks", order: 2 },
    ])
  })

  test("moves a brush into another set, at the position asked for", () => {
    const changes = reorderBrushes(brushes, "a", "Pencils", 0)
    expect(changes).toContainEqual({ id: "a", set: "Pencils", order: 0 })
    expect(changes).toContainEqual({ id: "d", set: "Pencils", order: 1 })
    // The set it left closes the gap behind it.
    expect(changes).toContainEqual({ id: "b", set: "Inks", order: 0 })
    expect(changes).toContainEqual({ id: "c", set: "Inks", order: 1 })
  })

  test("clamps a position past the end rather than refusing the drag", () => {
    expect(reorderBrushes(brushes, "a", "Inks", 99)).toEqual([
      { id: "b", set: "Inks", order: 0 },
      { id: "c", set: "Inks", order: 1 },
      { id: "a", set: "Inks", order: 2 },
    ])
  })

  test("an unknown brush changes nothing", () => {
    expect(reorderBrushes(brushes, "zz", "Inks", 0)).toEqual([])
  })
})

describe("a stored texture", () => {
  test("keeps one byte per texel and stays a reasonable size", () => {
    const texture = normaliseStoredTexture({
      width: 2,
      height: 2,
      data: new Uint8Array([1, 2, 3, 4]),
    })
    expect(texture.data.length).toBe(4)
    expect(() =>
      normaliseStoredTexture({ width: 2, height: 2, data: new Uint8Array(3) })
    ).toThrow()
    expect(() =>
      normaliseStoredTexture({
        width: MAX_TEXTURE_DIMENSION + 1,
        height: 1,
        data: new Uint8Array(MAX_TEXTURE_DIMENSION + 1),
      })
    ).toThrow()
  })
})
