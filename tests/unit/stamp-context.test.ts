import { describe, expect, test } from "bun:test"
import {
  createStampContextTracker,
  normalizeTilt,
  REFERENCE_SPEED,
  STROKE_PROGRESS_LENGTH,
} from "../../engine/brush/stamp-context"

describe("pen tilt normalisation", () => {
  test("an upright pen is zero tilt", () => {
    const [tilt] = normalizeTilt(0, 0)
    expect(tilt).toBe(0)
  })

  test("a pen laid over reads near one", () => {
    const [tilt] = normalizeTilt(89, 0)
    expect(tilt).toBeGreaterThan(0.95)
  })

  test("tilting 45 degrees on one axis is half way over", () => {
    // tan(45°) = 1, so the pen is 45° from vertical: half of a right angle.
    const [tilt] = normalizeTilt(45, 0)
    expect(tilt).toBeCloseTo(0.5, 6)
  })

  test("the direction is the way the pen leans, as a turn from +x", () => {
    expect(normalizeTilt(45, 0)[1]).toBeCloseTo(0, 6)
    expect(normalizeTilt(0, 45)[1]).toBeCloseTo(0.25, 6)
    expect(normalizeTilt(-45, 0)[1]).toBeCloseTo(0.5, 6)
    expect(normalizeTilt(0, -45)[1]).toBeCloseTo(0.75, 6)
  })

  test("an upright pen has no direction to report", () => {
    expect(normalizeTilt(0, 0)[1]).toBe(0)
  })

  test("a pen reported as exactly flat stays finite", () => {
    const [tilt, direction] = normalizeTilt(90, 90)
    expect(Number.isFinite(tilt)).toBe(true)
    expect(Number.isFinite(direction)).toBe(true)
    expect(tilt).toBeLessThanOrEqual(1)
  })
})

describe("stamp context from a stroke", () => {
  test("the first dab has no speed and no heading", () => {
    const tracker = createStampContextTracker()
    const context = tracker.begin(10, 10, 0.4, 0, 0, 0)
    expect(context.velocity).toBe(0)
    expect(context.direction).toBe(0)
    expect(context.pressure).toBeCloseTo(0.4, 6)
    expect(context.strokeProgress).toBe(0)
  })

  test("velocity is speed against the reference, and saturates", () => {
    const tracker = createStampContextTracker()
    tracker.begin(0, 0, 1, 0, 0, 0)
    // Half the reference speed over one millisecond.
    expect(
      tracker.next(REFERENCE_SPEED / 2, 0, 1, 0, 0, 1).velocity
    ).toBeCloseTo(0.5, 6)
    // Ten times it: faster than fast is still one.
    expect(tracker.next(REFERENCE_SPEED * 10.5, 0, 1, 0, 0, 2).velocity).toBe(1)
  })

  test("two dabs at one instant leave the last speed standing", () => {
    const tracker = createStampContextTracker()
    tracker.begin(0, 0, 1, 0, 0, 0)
    const moving = tracker.next(REFERENCE_SPEED / 2, 0, 1, 0, 0, 1).velocity
    expect(tracker.next(10, 0, 1, 0, 0, 1).velocity).toBe(moving)
  })

  test("direction is the heading of travel, as a turn from +x", () => {
    const tracker = createStampContextTracker()
    tracker.begin(0, 0, 1, 0, 0, 0)
    expect(tracker.next(5, 0, 1, 0, 0, 1).direction).toBeCloseTo(0, 6)
    expect(tracker.next(5, 5, 1, 0, 0, 2).direction).toBeCloseTo(0.25, 6)
    expect(tracker.next(0, 5, 1, 0, 0, 3).direction).toBeCloseTo(0.5, 6)
  })

  test("a dab in place keeps the heading it had", () => {
    const tracker = createStampContextTracker()
    tracker.begin(0, 0, 1, 0, 0, 0)
    tracker.next(0, 5, 1, 0, 0, 1)
    expect(tracker.next(0, 5, 1, 0, 0, 2).direction).toBeCloseTo(0.25, 6)
  })

  test("progress measures distance travelled, and saturates", () => {
    const tracker = createStampContextTracker()
    tracker.begin(0, 0, 1, 0, 0, 0)
    expect(
      tracker.next(STROKE_PROGRESS_LENGTH / 4, 0, 1, 0, 0, 100).strokeProgress
    ).toBeCloseTo(0.25, 6)
    expect(
      tracker.next(STROKE_PROGRESS_LENGTH * 2, 0, 1, 0, 0, 200).strokeProgress
    ).toBe(1)
  })

  test("pressure is passed through as the device reported it", () => {
    // A pen genuinely reports near zero as it lands and as it lifts, and that
    // is the taper a pressure mapping exists to draw. Whether a device has a
    // force sensor at all is decided once, at the sampler.
    const tracker = createStampContextTracker()
    expect(tracker.begin(0, 0, 0, 0, 0, 0).pressure).toBe(0)
    expect(tracker.next(1, 0, 0.42, 0, 0, 1).pressure).toBeCloseTo(0.42, 6)
  })

  test("random is fresh per dab and repeatable per seed", () => {
    const run = (seed: number) => {
      const tracker = createStampContextTracker()
      const values = [tracker.begin(0, 0, 1, 0, 0, 0, seed).random]
      for (let i = 1; i < 6; i++)
        values.push(tracker.next(i, 0, 1, 0, 0, i).random)
      return values
    }
    const first = run(7)
    expect(run(7)).toEqual(first)
    expect(run(8)).not.toEqual(first)
    expect(new Set(first).size).toBe(first.length)
    for (const value of first) {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })

  test("an unseeded tracker still varies when the caller varies the seed", () => {
    // The engine seeds each stroke, so two marks differ; one mark replayed
    // from its own seed is identical, which is what stroke replay needs.
    const tracker = createStampContextTracker()
    expect(tracker.begin(0, 0, 1, 0, 0, 0, 1).random).not.toBe(
      tracker.begin(0, 0, 1, 0, 0, 0, 2).random
    )
  })

  test("a second stroke starts clean", () => {
    const tracker = createStampContextTracker()
    tracker.begin(0, 0, 1, 0, 0, 0)
    tracker.next(200, 0, 1, 0, 0, 1)
    const context = tracker.begin(0, 0, 1, 0, 0, 1000)
    expect(context.strokeProgress).toBe(0)
    expect(context.velocity).toBe(0)
  })
})
