import { describe, expect, test } from "bun:test"
import {
  createFluidClock,
  FLUID_BUDGET_MS,
  FLUID_STEPS_PER_FRAME,
} from "../../engine/gpu/fluid-clock"

/** Milliseconds between frames on a 120 Hz and on a 60 Hz display. */
const AT_120 = 1000 / 120
const AT_60 = 1000 / 60

/** The steps each of `frames` frames runs, `interval` apart. */
function run(
  clock: ReturnType<typeof createFluidClock>,
  frames: number,
  interval: number,
  tiles: number
) {
  const steps: number[] = []
  for (let frame = 0; frame < frames; frame++)
    steps.push(clock.frame(interval, tiles))
  return steps
}

/** What a frame ran and skipped. */
function framed(
  clock: ReturnType<typeof createFluidClock>,
  elapsed: number,
  tiles: number
) {
  const steps = clock.frame(elapsed, tiles)
  return { steps, skipped: clock.skipped() }
}

/** A clock that reckons a step over one tile at `ms`. */
const reckoning = (ms: number) => createFluidClock({ tileStepMs: ms })

describe("the fluid clock (D42)", () => {
  test("a frame on a 120 Hz display runs one step", () => {
    expect(run(reckoning(0.01), 12, AT_120, 64)).toEqual(Array(12).fill(1))
  })

  test("a frame on a 60 Hz display runs two steps when the budget allows", () => {
    expect(FLUID_STEPS_PER_FRAME).toBe(2)
    expect(run(reckoning(0.01), 12, AT_60, 64)).toEqual(Array(12).fill(2))
  })

  test("the first frame after the clock starts runs one step", () => {
    const clock = reckoning(0.01)
    expect(clock.frame(undefined, 16)).toBe(1)
  })

  test("a late frame runs no more than two steps and is not made up for", () => {
    const clock = reckoning(0.01)
    expect(framed(clock, 250, 16)).toEqual({ steps: 2, skipped: 0 })
    expect(run(clock, 4, AT_120, 16)).toEqual([1, 1, 1, 1])
  })

  test("over budget, the steps a frame cannot afford are skipped", () => {
    // Two steps over 64 tiles are 2.56 ms: one fits in the budget.
    const clock = reckoning(0.02)
    const frames = Array.from({ length: 6 }, () => framed(clock, AT_60, 64))
    expect(frames).toEqual(Array(6).fill({ steps: 1, skipped: 1 }))
  })

  test("skipped steps are not made up once the frame is cheap again", () => {
    const clock = reckoning(0.02)
    run(clock, 6, AT_60, 64)
    // A body settled: what is left is cheap, and the clock runs at its rate
    // from here, not faster.
    expect(run(clock, 4, AT_60, 4)).toEqual([2, 2, 2, 2])
    expect(run(clock, 4, AT_120, 4)).toEqual([1, 1, 1, 1])
  })

  test("a step dearer than the whole budget still runs, as often as the budget pays for it", () => {
    // 64 tiles at 0.05 ms are 3.2 ms a step, more than a frame's 2 ms.
    const clock = reckoning(0.05)
    const steps = run(clock, 60, AT_120, 64)
    expect(Math.max(...steps)).toBe(1)
    const ran = steps.reduce((total, n) => total + n, 0)
    // The simulation's GPU time over the run is within its budget, and the
    // paint still moves: it dries, later.
    expect(ran * 3.2).toBeLessThanOrEqual(60 * FLUID_BUDGET_MS + 3.2)
    expect(ran).toBeGreaterThanOrEqual(Math.floor((60 * FLUID_BUDGET_MS) / 3.2))
  })

  test("what a step is measured to add is what the clock reckons with", () => {
    const clock = reckoning(0.001)
    expect(clock.frame(AT_60, 64)).toBe(2)
    // One step over 64 tiles fenced at 5.5 ms and two at 8: each step adds
    // 2.5 ms, 0.039 ms a tile, and two steps a frame no longer fit.
    for (let i = 0; i < 30; i++) {
      clock.measured(1, 64, 5.5)
      clock.measured(2, 64, 8)
    }
    expect(clock.tileStepMs()).toBeCloseTo(2.5 / 64, 2)
    expect(framed(clock, AT_60, 64)).toEqual({ steps: 0, skipped: 2 })
  })

  test("the latency every fence has is not reckoned as the step's", () => {
    // A fence resolves milliseconds after the work it waits on, a lone step
    // or a pair, few tiles or many: that is no cost of the step's.
    const clock = reckoning(0.05)
    for (let i = 0; i < 40; i++)
      for (const [steps, tiles] of [
        [1, 16],
        [2, 16],
        [1, 64],
        [2, 64],
      ])
        clock.measured(steps, tiles, 2.6 + steps * tiles * 0.01)
    expect(clock.tileStepMs()).toBeCloseTo(0.01, 2)
  })

  test("measurements that never vary in size leave the reckoning where it was", () => {
    // One step over the same tiles every frame: the fence's latency and the
    // step's cost cannot be told apart, so neither is guessed at.
    const clock = reckoning(0.024)
    for (let i = 0; i < 50; i++) clock.measured(1, 64, 3.2)
    expect(clock.tileStepMs()).toBeCloseTo(0.024, 3)
  })

  test("one slow measurement moves the reckoning only part of the way", () => {
    const clock = reckoning(0.01)
    for (let i = 0; i < 20; i++) {
      clock.measured(1, 16, 0.16)
      clock.measured(2, 16, 0.32)
    }
    clock.measured(2, 64, 64)
    expect(clock.tileStepMs()).toBeGreaterThan(0.01)
    expect(clock.tileStepMs()).toBeLessThan(0.25)
  })

  test("a measurement of no steps or no tiles is not one", () => {
    const clock = reckoning(0.01)
    clock.measured(0, 64, 3)
    clock.measured(2, 0, 3)
    clock.measured(2, 64, Number.NaN)
    expect(clock.tileStepMs()).toBe(0.01)
  })

  test("stopping forgets what was owed and what was saved", () => {
    const clock = reckoning(0.05)
    run(clock, 3, AT_120, 64)
    clock.stop()
    // Started again, its first frame is a first frame.
    expect(clock.frame(undefined, 1)).toBe(1)
  })
})
