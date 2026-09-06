import { describe, expect, test } from "bun:test"

import { type Brush, DEFAULT_BRUSH } from "../../engine/brush/brush"
import { type Modulator, validateDynamics } from "../../engine/brush/dynamics"
import {
  brushCommand,
  editBrush,
  featherOf,
  hardnessOf,
  isBrushEdited,
  MAX_FEATHER,
  newModulator,
} from "../../features/studio/lib/brush-draft"

function saved(): Brush {
  return structuredClone(DEFAULT_BRUSH)
}

describe("the working brush an editor holds", () => {
  test("an edit leaves the brush it came from untouched", () => {
    const original = saved()
    const edited = editBrush(original, { shape: { radius: 40 } })
    expect(edited.shape.radius).toBe(40)
    expect(original.shape.radius).toBe(DEFAULT_BRUSH.shape.radius)
    // Only the named field moves; the rest of the section comes with it.
    expect(edited.shape.spacing).toBe(original.shape.spacing)
    expect(edited.id).toBe(original.id)
  })

  test("grain arrives whole and can be taken away again", () => {
    const grained = editBrush(saved(), {
      grain: { textureId: "paper", scale: 2, depth: 0.5, movement: 0 },
    })
    expect(grained.grain).toEqual({
      textureId: "paper",
      scale: 2,
      depth: 0.5,
      movement: 0,
    })
    const smooth = editBrush(grained, { grain: null })
    // Absent rather than present-and-null: a brush is the JSON it round-trips
    // as, and a null grain is not a field the engine's model has.
    expect("grain" in smooth).toBe(false)
  })

  test("an edited brush is dirty against the one that was saved", () => {
    const original = saved()
    expect(isBrushEdited(original, structuredClone(original))).toBe(false)
    expect(
      isBrushEdited(original, editBrush(original, { shape: { angle: 0.25 } }))
    ).toBe(true)
    // A field set back to what it was is not an edit, however it got there.
    const returned = editBrush(
      editBrush(original, { shape: { angle: 0.25 } }),
      { shape: { angle: DEFAULT_BRUSH.shape.angle } }
    )
    expect(isBrushEdited(original, returned)).toBe(false)
  })

  test("dynamics are compared by what they say, not by identity", () => {
    const modulator: Modulator = {
      source: "pressure",
      target: "size",
      range: [0.1, 1],
      mix: "multiply",
    }
    const original = editBrush(saved(), { dynamics: [modulator] })
    const copy = editBrush(original, { dynamics: [{ ...modulator }] })
    expect(isBrushEdited(original, copy)).toBe(false)
    const moved = editBrush(original, {
      dynamics: [{ ...modulator, range: [0.5, 1] }],
    })
    expect(isBrushEdited(original, moved)).toBe(true)
  })

  test("the command carries every field, so the engine holds the whole brush", () => {
    const brush = editBrush(saved(), {
      shape: {
        radius: 12,
        feather: 3,
        roundness: 0.4,
        angle: 0.1,
        spacing: 0.5,
      },
      rendering: { opacity: 0.6, flow: 0.3, accumulation: "buildup" },
    })
    expect(brushCommand(brush)).toEqual({
      type: "setBrush",
      id: brush.id,
      name: brush.name,
      radius: 12,
      feather: 3,
      roundness: 0.4,
      angle: 0.1,
      spacing: 0.5,
      opacity: 0.6,
      flow: 0.3,
      accumulation: "buildup",
      tipTextureId: null,
      grain: null,
      dynamics: [],
    })
  })

  test("a texture the brush no longer names is cleared, not left behind", () => {
    const textured = editBrush(saved(), {
      shape: { tipTextureId: "charcoal" },
      grain: { textureId: "paper", scale: 1, depth: 0.4, movement: 0.2 },
    })
    const command = brushCommand(textured)
    expect(command.tipTextureId).toBe("charcoal")
    expect(command.grain).toEqual({
      textureId: "paper",
      scale: 1,
      depth: 0.4,
      movement: 0.2,
    })
    expect(
      brushCommand(editBrush(textured, { shape: { tipTextureId: null } }))
        .tipTextureId
    ).toBe(null)
  })

  test("a new mapping is one the engine will accept", () => {
    // Offset targets take add, scaling targets take multiply: a mapping the
    // artist adds must never be one `validateDynamics` throws on.
    expect(newModulator("size")).toEqual({
      source: "pressure",
      target: "size",
      range: [0, 1],
      mix: "multiply",
    })
    expect(newModulator("scatter").mix).toBe("add")
    expect(newModulator("angle").mix).toBe("add")
    expect(newModulator("hue").mix).toBe("add")
    for (const target of ["size", "scatter", "angle", "hue", "flow"] as const)
      expect(() => validateDynamics([newModulator(target)])).not.toThrow()
  })

  test("a field a control had nothing to say about is left alone", () => {
    // A control that owns one property builds its patch from state that may
    // hold nothing yet; an explicit undefined must not erase what is there.
    const brush = editBrush(saved(), { shape: { radius: undefined } })
    expect(brush.shape.radius).toBe(DEFAULT_BRUSH.shape.radius)
  })

  test("a brush is unedited however its fields came to be in that order", () => {
    // A brush stored with its tip named before its spacing, against the same
    // brush after the editor took the tip off and put it back — which leaves
    // the key at the end. Identical brushes; different text.
    const stored: Brush = {
      ...saved(),
      shape: {
        radius: 6,
        feather: 1,
        tipTextureId: "charcoal",
        roundness: 1,
        angle: 0,
        spacing: 0.25,
      },
    }
    const rebuilt = editBrush(
      editBrush(stored, { shape: { tipTextureId: null } }),
      { shape: { tipTextureId: "charcoal" } }
    )
    expect(JSON.stringify(rebuilt)).not.toBe(JSON.stringify(stored))
    expect(isBrushEdited(stored, rebuilt)).toBe(false)
  })

  test("a key holding nothing is the same as no key at all", () => {
    // The engine builds its brush by spreading a patch, and a copy made
    // elsewhere can carry an optional field as an explicit undefined. Calling
    // that an edit would light Save on a brush nobody had touched.
    const brush = saved()
    const withEmptyKey: Brush = {
      ...brush,
      shape: { ...brush.shape, tipTextureId: undefined },
    }
    expect("tipTextureId" in withEmptyKey.shape).toBe(true)
    expect(isBrushEdited(brush, withEmptyKey)).toBe(false)
  })

  test("hardness and feather are two readings of one edge", () => {
    expect(hardnessOf(0)).toBe(1)
    expect(hardnessOf(MAX_FEATHER)).toBe(0)
    expect(featherOf(1)).toBe(0)
    expect(featherOf(0)).toBe(MAX_FEATHER)
    // The round trip is what the slider depends on: a hardness set and read
    // back must be the hardness that was set.
    for (const hardness of [0, 0.25, 0.5, 0.75, 1])
      expect(hardnessOf(featherOf(hardness))).toBeCloseTo(hardness, 6)
    // A brush from elsewhere may carry a softer edge than the slider spans.
    expect(hardnessOf(MAX_FEATHER * 4)).toBe(0)
  })
})
