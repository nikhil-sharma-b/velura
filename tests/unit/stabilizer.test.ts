import { describe, expect, test } from "bun:test"
import {
  createStabilizer,
  MAX_STABILIZER_PULL,
} from "../../engine/geom/stabilizer"

type Point = { x: number; y: number }

/** A straight run with a repeatable hand tremor across it. */
function shakyLine(count: number, amplitude: number): Point[] {
  return Array.from({ length: count }, (_, i) => ({
    x: i * 4,
    y: Math.sin(i * 1.7) * amplitude,
  }))
}

function follow(strength: number, points: readonly Point[]): Point[] {
  const stabilizer = createStabilizer()
  stabilizer.setStrength(strength)
  stabilizer.begin(points[0].x, points[0].y)
  return points.slice(1).map((point) => {
    const filtered = stabilizer.filter(point.x, point.y)
    // The stabilizer returns a shared point, so callers must copy to retain it.
    return { x: filtered.x, y: filtered.y }
  })
}

/** Mean absolute deviation from the y = 0 line the tremor rides on. */
function wobble(points: readonly Point[]): number {
  return points.reduce((sum, p) => sum + Math.abs(p.y), 0) / points.length
}

describe("pulled-string stabilizer", () => {
  test("zero strength passes samples through untouched", () => {
    const points = shakyLine(40, 6)
    expect(follow(0, points)).toEqual(points.slice(1))
  })

  test("strength suppresses tremor", () => {
    const points = shakyLine(60, 6)
    expect(wobble(follow(0.5, points))).toBeLessThan(
      wobble(points.slice(1)) / 2
    )
  })

  test("more strength suppresses more tremor", () => {
    const points = shakyLine(60, 6)
    expect(wobble(follow(1, points))).toBeLessThan(wobble(follow(0.3, points)))
  })

  test("the stabilized point trails the pen by at most the pull radius", () => {
    const points = shakyLine(60, 6)
    const stabilizer = createStabilizer()
    stabilizer.setStrength(0.5)
    stabilizer.begin(points[0].x, points[0].y)
    for (const point of points.slice(1)) {
      const filtered = stabilizer.filter(point.x, point.y)
      expect(
        Math.hypot(filtered.x - point.x, filtered.y - point.y)
      ).toBeLessThanOrEqual(0.5 * MAX_STABILIZER_PULL + 1e-9)
    }
  })

  test("a long straight run catches up with the pen's direction", () => {
    // The string is dragged taut: the stabilized path is parallel to the pen's,
    // lagging behind it rather than drifting off course.
    const points = Array.from({ length: 200 }, (_, i) => ({ x: i * 4, y: 0 }))
    const filtered = follow(0.4, points)
    expect(filtered.at(-1)!.y).toBeCloseTo(0, 6)
    expect(points.at(-1)!.x - filtered.at(-1)!.x).toBeCloseTo(
      0.4 * MAX_STABILIZER_PULL,
      6
    )
  })

  test("strength changes mid-stroke without jumping the anchor", () => {
    const stabilizer = createStabilizer()
    stabilizer.setStrength(1)
    stabilizer.begin(0, 0)
    for (let i = 1; i <= 50; i++) stabilizer.filter(i * 4, 0)
    const lagged = stabilizer.filter(204, 0).x
    stabilizer.setStrength(0)
    // Loosening the string lets the anchor reach the pen, never teleport past.
    const released = stabilizer.filter(208, 0)
    expect(released.x).toBe(208)
    expect(lagged).toBeLessThan(208)
  })

  test("a new stroke starts under the pen rather than at the last anchor", () => {
    const stabilizer = createStabilizer()
    stabilizer.setStrength(0.8)
    stabilizer.begin(0, 0)
    for (let i = 1; i <= 20; i++) stabilizer.filter(i * 10, 0)
    stabilizer.begin(500, 500)
    const first = stabilizer.filter(504, 500)
    expect(Math.hypot(first.x - 504, first.y - 500)).toBeLessThanOrEqual(
      0.8 * MAX_STABILIZER_PULL
    )
    expect(first.x).toBeGreaterThan(499)
  })

  test("strength is clamped to the usable range", () => {
    const stabilizer = createStabilizer()
    stabilizer.setStrength(4)
    expect(stabilizer.strength()).toBe(1)
    stabilizer.setStrength(-2)
    expect(stabilizer.strength()).toBe(0)
    stabilizer.setStrength(Number.NaN)
    expect(stabilizer.strength()).toBe(0)
  })
})
