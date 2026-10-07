import { describe, expect, test } from "bun:test"
import {
  type BrushScatter,
  createScatterPlacer,
  MAX_SCATTER_COUNT,
} from "../../engine/brush/scatter"

const RADIUS = 10

/** Every offset a run of dabs is given, as `[dx, dy]` pairs. */
function offsets(
  scatter: BrushScatter | undefined,
  options: { seed?: number; dabs?: number; scale?: number; direction?: number }
): [number, number][][] {
  const placer = createScatterPlacer()
  placer.begin(options.seed ?? 1)
  const out = new Float32Array(MAX_SCATTER_COUNT * 2)
  const runs: [number, number][][] = []
  for (let dab = 0; dab < (options.dabs ?? 50); dab++) {
    const count = placer.place(
      scatter,
      options.scale ?? 1,
      RADIUS,
      options.direction ?? 0,
      out
    )
    const run: [number, number][] = []
    for (let i = 0; i < count; i++) run.push([out[i * 2], out[i * 2 + 1]])
    runs.push(run)
  }
  return runs
}

describe("scatter placement", () => {
  test("a brush without scatter lays one dab exactly on the path", () => {
    for (const run of offsets(undefined, {})) expect(run).toEqual([[0, 0]])
    for (const run of offsets({ amount: 0, count: 1, axes: "both" }, {}))
      expect(run).toEqual([[0, 0]])
  })

  test("count multiplies the dabs laid per spacing step", () => {
    const runs = offsets({ amount: 1, count: 3, axes: "both" }, { dabs: 4 })
    expect(runs.map((run) => run.length)).toEqual([3, 3, 3, 3])
  })

  test("the same seed places the same stroke; another seed does not", () => {
    const scatter: BrushScatter = { amount: 2, count: 2, axes: "both" }
    expect(offsets(scatter, { seed: 7 })).toEqual(offsets(scatter, { seed: 7 }))
    expect(offsets(scatter, { seed: 7 })).not.toEqual(
      offsets(scatter, { seed: 8 })
    )
  })

  test("across moves dabs only perpendicular to travel, within the amount", () => {
    const scatter: BrushScatter = { amount: 2, count: 1, axes: "across" }
    // Heading +x: across is the y axis.
    const flat = offsets(scatter, { direction: 0 }).flat()
    for (const [dx, dy] of flat) {
      expect(dx).toBeCloseTo(0, 5)
      expect(Math.abs(dy)).toBeLessThanOrEqual(20)
    }
    expect(Math.max(...flat.map(([, dy]) => Math.abs(dy)))).toBeGreaterThan(10)
    // Heading +y (a quarter turn clockwise): across is the x axis.
    for (const [dx, dy] of offsets(scatter, { direction: 0.25 }).flat()) {
      expect(dy).toBeCloseTo(0, 5)
      expect(Math.abs(dx)).toBeLessThanOrEqual(20)
    }
  })

  test("both moves dabs along the path as well as across it", () => {
    const flat = offsets({ amount: 2, count: 1, axes: "both" }, {}).flat()
    for (const [dx, dy] of flat) {
      expect(Math.abs(dx)).toBeLessThanOrEqual(20)
      expect(Math.abs(dy)).toBeLessThanOrEqual(20)
    }
    expect(Math.max(...flat.map(([dx]) => Math.abs(dx)))).toBeGreaterThan(10)
  })

  test("the dynamics scale multiplies the amount", () => {
    const scatter: BrushScatter = { amount: 2, count: 1, axes: "across" }
    for (const run of offsets(scatter, { scale: 0 }))
      expect(run).toEqual([[0, 0]])
    const full = offsets(scatter, { seed: 3 }).flat()
    const half = offsets(scatter, { seed: 3, scale: 0.5 }).flat()
    half.forEach(([, dy], i) => expect(dy).toBeCloseTo(full[i][1] / 2, 4))
  })
})
