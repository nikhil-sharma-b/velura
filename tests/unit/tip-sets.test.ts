import { expect, test } from "bun:test"
import { selectTipFrame } from "../../engine/brush/tip-sets"
import { NEUTRAL_STAMP_CONTEXT } from "../../engine/brush/dynamics"

test("sequential frames cycle across dabs, starting at zero", () => {
  expect(
    Array.from({ length: 6 }, (_, i) =>
      selectTipFrame("sequential", 4, NEUTRAL_STAMP_CONTEXT, i)
    )
  ).toEqual([0, 1, 2, 3, 0, 1])
})

test("direction wraps clockwise turns through the four frames", () => {
  expect(
    [0, 0.25, 0.5, 0.75, 1, -0.25].map((direction) =>
      selectTipFrame("direction", 4, { ...NEUTRAL_STAMP_CONTEXT, direction }, 0)
    )
  ).toEqual([0, 1, 2, 3, 0, 3])
})
test("pressure bins include both endpoints and clamp outside the sensor range", () => {
  expect(
    [-1, 0, 0.249, 0.25, 0.5, 0.75, 1, 2].map((pressure) =>
      selectTipFrame("pressure", 4, { ...NEUTRAL_STAMP_CONTEXT, pressure }, 0)
    )
  ).toEqual([0, 0, 0, 1, 2, 3, 3, 3])
})
test("random uses the seeded per-dab context rather than an independent random stream", () => {
  expect(
    [0, 0.24, 0.25, 0.6, 0.99].map((random) =>
      selectTipFrame("random", 4, { ...NEUTRAL_STAMP_CONTEXT, random }, 42)
    )
  ).toEqual([0, 0, 1, 2, 3])
  for (const mode of ["random", "sequential", "direction", "pressure"] as const)
    expect(selectTipFrame(mode, 1, NEUTRAL_STAMP_CONTEXT, 99)).toBe(0)
})

test("brush validation preserves frame selection and rejects unknown modes", async () => {
  const { normaliseBrushDefinition } = await import("../../convex/lib/brush")
  const { DEFAULT_BRUSH } = await import("../../engine/brush/brush")
  for (const tipSelection of [
    "random",
    "sequential",
    "direction",
    "pressure",
  ] as const) {
    const brush = normaliseBrushDefinition({
      ...DEFAULT_BRUSH,
      shape: { ...DEFAULT_BRUSH.shape, tipTextureId: "set", tipSelection },
    })
    expect(brush.shape.tipSelection).toBe(tipSelection)
  }
  expect(
    normaliseBrushDefinition(DEFAULT_BRUSH).shape.tipSelection
  ).toBeUndefined()
  expect(() =>
    normaliseBrushDefinition({
      ...DEFAULT_BRUSH,
      shape: { ...DEFAULT_BRUSH.shape, tipSelection: "velocity" },
    })
  ).toThrow()
})

test("stored texture validation preserves all frames with a bounded byte budget", async () => {
  const { normaliseStoredTexture } = await import("../../convex/lib/brush")
  const data = new Uint8Array([20, 40, 60, 80])
  expect(
    normaliseStoredTexture({ width: 1, height: 1, frameCount: 4, data })
  ).toEqual({ width: 1, height: 1, frameCount: 4, data })
  expect(() =>
    normaliseStoredTexture({ width: 1, height: 1, frameCount: 0, data })
  ).toThrow()
  expect(() =>
    normaliseStoredTexture({
      width: 512,
      height: 512,
      frameCount: 4,
      data: new Uint8Array(512 * 512 * 4),
    })
  ).toThrow()
})
