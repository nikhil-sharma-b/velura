import { describe, expect, test } from "bun:test"
import {
  BENCHMARK_WORKLOAD,
  createWorkload,
  workloadStats,
} from "../../bench/workload"

const options = {
  width: 8192,
  height: 8192,
  strokes: 4,
  sampleRateHz: 240,
  penSpeed: 3000,
  seed: 7,
}

describe("createWorkload", () => {
  test("is deterministic for a seed and differs between seeds", () => {
    expect(createWorkload(options)).toEqual(createWorkload(options))
    expect(createWorkload({ ...options, seed: 8 })).not.toEqual(
      createWorkload(options)
    )
  })

  test("emits the requested number of strokes on the requested canvas", () => {
    const workload = createWorkload(options)
    expect(workload.width).toBe(8192)
    expect(workload.height).toBe(8192)
    expect(workload.strokes).toHaveLength(4)
  })

  test("samples arrive at the pen's rate, in order, within the canvas", () => {
    const workload = createWorkload(options)
    const period = 1000 / options.sampleRateHz
    for (const stroke of workload.strokes) {
      // A stroke a resampler can do anything with needs more than a dab.
      expect(stroke.samples.length).toBeGreaterThan(10)
      stroke.samples.forEach((sample, i) => {
        expect(sample.x).toBeGreaterThanOrEqual(0)
        expect(sample.x).toBeLessThanOrEqual(8192)
        expect(sample.y).toBeGreaterThanOrEqual(0)
        expect(sample.y).toBeLessThanOrEqual(8192)
        expect(sample.pressure).toBeGreaterThan(0)
        expect(sample.pressure).toBeLessThanOrEqual(1)
        if (i === 0) return
        expect(sample.time - stroke.samples[i - 1].time).toBeCloseTo(period, 6)
      })
    }
  })

  test("strokes cross the canvas rather than dabbing one corner", () => {
    const workload = createWorkload(options)
    for (const stroke of workload.strokes) {
      const first = stroke.samples[0]
      const last = stroke.samples[stroke.samples.length - 1]
      expect(Math.hypot(last.x - first.x, last.y - first.y)).toBeGreaterThan(
        1000
      )
    }
  })

  test("pressure tapers in and out rather than sitting flat", () => {
    const [stroke] = createWorkload(options).strokes
    const middle = stroke.samples[Math.floor(stroke.samples.length / 2)]
    expect(stroke.samples[0].pressure).toBeLessThan(middle.pressure)
    expect(stroke.samples[stroke.samples.length - 1].pressure).toBeLessThan(
      middle.pressure
    )
  })

  test("rejects a workload that could not be drawn", () => {
    expect(() => createWorkload({ ...options, strokes: 0 })).toThrow()
    expect(() => createWorkload({ ...options, sampleRateHz: 0 })).toThrow()
    expect(() => createWorkload({ ...options, width: 0 })).toThrow()
    expect(() => createWorkload({ ...options, penSpeed: -1 })).toThrow()
  })
})

describe("workloadStats", () => {
  test("counts samples and reports how long the pen is down", () => {
    const workload = createWorkload(options)
    const stats = workloadStats(workload)
    expect(stats.samples).toBe(
      workload.strokes.reduce((n, stroke) => n + stroke.samples.length, 0)
    )
    expect(stats.penDownMs).toBeGreaterThan(0)
    expect(stats.strokes).toBe(4)
  })
})

describe("BENCHMARK_WORKLOAD", () => {
  test("is the full-size canvas the target is stated against", () => {
    expect(BENCHMARK_WORKLOAD.width).toBe(8192)
    expect(BENCHMARK_WORKLOAD.height).toBe(8192)
  })
})
