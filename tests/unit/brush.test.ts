import { describe, expect, test } from "bun:test"
import {
  type Brush,
  brushSpacing,
  cloneBrush,
  DEFAULT_BRUSH,
} from "../../engine/brush/brush"
import { validateDynamics } from "../../engine/brush/dynamics"

/** A brush that uses every part of the model, as a library entry would. */
const PENCIL: Brush = {
  id: "pencil",
  name: "Pencil",
  shape: {
    radius: 4,
    feather: 0.5,
    roundness: 0.4,
    angle: 0.125,
    spacing: 0.1,
    tipTextureId: "graphite",
  },
  rendering: { accumulation: "buildup", opacity: 0.9, flow: 0.3 },
  dynamics: [
    {
      source: "pressure",
      target: "size",
      range: [0.3, 1],
      mix: "multiply",
      curve: [
        { x: 0, y: 0 },
        { x: 0.5, y: 0.35 },
        { x: 1, y: 1 },
      ],
    },
    { source: "tilt", target: "roundness", range: [1, 0.2], mix: "multiply" },
    { source: "direction", target: "angle", range: [0, 1], mix: "replace" },
  ],
}

describe("brush definition", () => {
  test("a brush survives a round trip through JSON unchanged", () => {
    // The whole point of D23: a brush is data, so it can be stored, synced and
    // shipped. Anything that failed to survive this would be code in disguise.
    expect(JSON.parse(JSON.stringify(PENCIL))).toEqual(PENCIL)
    expect(JSON.parse(JSON.stringify(DEFAULT_BRUSH))).toEqual(DEFAULT_BRUSH)
  })

  test("a brush holds no functions anywhere in its tree", () => {
    const inspect = (value: unknown): void => {
      expect(typeof value).not.toBe("function")
      if (value && typeof value === "object")
        Object.values(value).forEach(inspect)
    }
    inspect(PENCIL)
  })

  test("the default brush is a valid graph", () => {
    expect(() => validateDynamics(DEFAULT_BRUSH.dynamics)).not.toThrow()
    expect(() => validateDynamics(PENCIL.dynamics)).not.toThrow()
  })

  test("spacing is a fraction of the dab diameter", () => {
    expect(brushSpacing(PENCIL)).toBeCloseTo(4 * 2 * 0.1, 6)
  })

  test("spacing never reaches zero, however fine the brush", () => {
    // A spacing of zero would place infinitely many dabs on one segment.
    const hair = { ...PENCIL, shape: { ...PENCIL.shape, spacing: 0 } }
    expect(brushSpacing(hair)).toBeGreaterThan(0)
  })

  test("a clone shares nothing with the brush it came from", () => {
    const copy = cloneBrush(PENCIL)
    expect(copy).toEqual(PENCIL)
    copy.dynamics[0].range = [0, 0]
    copy.shape.radius = 99
    expect(PENCIL.dynamics[0].range).toEqual([0.3, 1])
    expect(PENCIL.shape.radius).toBe(4)
  })
})
