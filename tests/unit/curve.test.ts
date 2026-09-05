import { describe, expect, test } from "bun:test"
import {
  type Curve,
  curveSegment,
  LINEAR_CURVE,
  sampleCurve,
} from "../../engine/brush/curve"

/** Light touch, strong output: the curve bows above the diagonal. */
const SOFT: Curve = [
  { x: 0, y: 0 },
  { x: 0.5, y: 0.8 },
  { x: 1, y: 1 },
]

/** Heavy touch needed: the curve sags below it. */
const HARD: Curve = [
  { x: 0, y: 0 },
  { x: 0.5, y: 0.25 },
  { x: 1, y: 1 },
]

describe("dynamics response curve", () => {
  test("the linear curve returns its input untouched", () => {
    for (const input of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1])
      expect(sampleCurve(LINEAR_CURVE, input)).toBeCloseTo(input, 6)
  })

  test("a curve passes exactly through the points it was authored with", () => {
    expect(sampleCurve(HARD, 0)).toBeCloseTo(0, 6)
    expect(sampleCurve(HARD, 0.5)).toBeCloseTo(0.25, 5)
    expect(sampleCurve(HARD, 1)).toBeCloseTo(1, 6)
  })

  test("a soft curve lifts light input and a hard curve suppresses it", () => {
    expect(sampleCurve(SOFT, 0.25)).toBeGreaterThan(0.25)
    expect(sampleCurve(HARD, 0.25)).toBeLessThan(0.25)
  })

  test("output is monotonic when the authored points are", () => {
    let previous = -1
    for (let i = 0; i <= 100; i++) {
      const value = sampleCurve(HARD, i / 100)
      expect(value).toBeGreaterThanOrEqual(previous)
      previous = value
    }
  })

  test("input outside the unit range is clamped, not extrapolated", () => {
    expect(sampleCurve(HARD, -5)).toBe(sampleCurve(HARD, 0))
    expect(sampleCurve(HARD, 5)).toBe(sampleCurve(HARD, 1))
  })

  test("a curve of fewer than two points is the identity", () => {
    expect(sampleCurve([{ x: 0.5, y: 0.5 }], 0.3)).toBeCloseTo(0.3, 6)
  })

  test("the segments the editor draws are the ones sampled", () => {
    // The widget renders `curveSegment` as a bezier; sampling walks the same
    // control points, so the drawn line is the evaluated response.
    const { p1, c1, c2, p2 } = curveSegment(HARD, 0)
    expect(p1).toEqual({ x: 0, y: 0 })
    expect(p2).toEqual({ x: 0.5, y: 0.25 })
    for (const control of [c1, c2]) {
      expect(control.x).toBeGreaterThanOrEqual(p1.x)
      expect(control.x).toBeLessThanOrEqual(p2.x)
    }
  })
})
