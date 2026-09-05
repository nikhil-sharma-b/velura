import { describe, expect, test } from "bun:test"
import {
  judge,
  PERFORMANCE_TARGET,
  summarize,
  type FrameRecord,
} from "../../bench/report"

/** Frames at a fixed interval, each costing the same, with a fixed latency. */
function frames(
  count: number,
  intervalMs: number,
  latencyMs: number,
  cpuMs = 1
): FrameRecord[] {
  return Array.from({ length: count }, (_, i) => ({
    start: i * intervalMs,
    cpuMs,
    stamps: 40,
    latencyMs,
  }))
}

describe("summarize", () => {
  test("reports the frame rate the intervals imply", () => {
    const report = summarize(frames(200, 1000 / 120, 4), { warmupFrames: 0 })
    expect(report.frameRate.median).toBeCloseTo(120, 3)
    expect(report.frameRate.sustained).toBeCloseTo(120, 3)
    expect(report.frameIntervalMs.median).toBeCloseTo(1000 / 120, 6)
  })

  test("judges a run against the stated target", () => {
    const fast = summarize(frames(200, 1000 / 120, 4), { warmupFrames: 0 })
    expect(fast.meetsTarget.frameRate).toBe(true)
    expect(fast.meetsTarget.latency).toBe(true)
    expect(fast.meetsTarget.overall).toBe(true)

    const slow = summarize(frames(200, 1000 / 45, 22), { warmupFrames: 0 })
    expect(slow.meetsTarget.frameRate).toBe(false)
    expect(slow.meetsTarget.latency).toBe(false)
    expect(slow.meetsTarget.overall).toBe(false)
  })

  test("the target is the one the architecture states", () => {
    expect(PERFORMANCE_TARGET).toEqual({ fps: 120, latencyMs: 10 })
  })

  test("sustained rate follows the slow frames, not the median", () => {
    const mixed = frames(100, 1000 / 120, 4)
    // Eight frames in a hundred take far longer: the median is
    // untouched and the sustained figure is not.
    for (let i = 1; i <= 8; i++) mixed[i * 10].start += 30
    const report = summarize(mixed, { warmupFrames: 0 })
    expect(report.frameRate.median).toBeCloseTo(120, 1)
    expect(report.frameRate.sustained).toBeLessThan(60)
  })

  test("discards warm-up frames, where shaders and tiles are still cold", () => {
    const run = [
      ...frames(10, 50, 60, 40),
      ...frames(100, 1000 / 120, 4).map((frame) => ({
        ...frame,
        start: frame.start + 500,
      })),
    ]
    const report = summarize(run, { warmupFrames: 10 })
    expect(report.frames).toBe(100)
    expect(report.frameRate.median).toBeCloseTo(120, 1)
    expect(report.latencyMs.max).toBe(4)
  })

  test("counts a frame that stutters against the run's own rhythm as dropped", () => {
    const run = frames(100, 1000 / 120, 4)
    run[50].start += 20
    const report = summarize(run, { warmupFrames: 0 })
    expect(report.droppedFrames).toBe(1)
  })

  test("a burst of free frames does not make the honest ones look dropped", () => {
    // Vsync off: the CPU runs ahead at a fraction of a millisecond a frame and
    // the GPU catches up in bursts. Against that median every real frame looks
    // like a stall, and none of them missed the target period.
    const run = frames(100, 0.7, 4)
    for (let i = 0; i < 100; i += 4) run[i].start += 3
    const report = summarize(run, { warmupFrames: 0 })
    expect(report.droppedFrames).toBe(0)
  })

  test("a steady run below the target drops nothing", () => {
    // 75 Hz on a 75 Hz panel is the panel's doing, not a stutter. Judging
    // drops against the 120 fps target would call four frames in five dropped.
    const report = summarize(frames(100, 1000 / 75, 6), { warmupFrames: 0 })
    expect(report.droppedFrames).toBe(0)
    expect(report.meetsTarget.frameRate).toBe(false)
  })

  test("frames that drew nothing carry no latency and are left out of it", () => {
    const run = frames(100, 1000 / 120, 4)
    run.forEach((frame, i) => {
      if (i % 2) frame.latencyMs = null
    })
    const report = summarize(run, { warmupFrames: 0 })
    expect(report.latencyMs.samples).toBe(50)
    expect(report.latencyMs.median).toBe(4)
    expect(report.frames).toBe(100)
  })

  test("reports the work done, so a cheap run is not read as a fast one", () => {
    const report = summarize(frames(100, 1000 / 120, 4), { warmupFrames: 0 })
    expect(report.stamps.total).toBe(4000)
    expect(report.stamps.perFrameMedian).toBe(40)
    expect(report.cpuMs.median).toBe(1)
  })

  test("refuses a run too short to say anything about", () => {
    expect(() => summarize(frames(3, 8, 4), { warmupFrames: 10 })).toThrow()
  })
})

describe("judge", () => {
  const fast = summarize(frames(200, 1000 / 144, 30), { warmupFrames: 0 })
  const slowButPrompt = summarize(frames(200, 1000 / 60, 6), {
    warmupFrames: 0,
  })

  test("takes the frame rate unpaced and the latency display-paced", () => {
    // The unpaced pass clears 120 fps but its queued frames time out at 30 ms;
    // the paced pass is held to the panel but answers the pen in 6 ms. Read
    // each from the pass that can tell the truth about it, the run passes.
    expect(judge(fast, slowButPrompt)).toEqual({
      frameRate: true,
      latency: true,
      overall: true,
    })
  })

  test("one failing number fails the run", () => {
    expect(judge(slowButPrompt, slowButPrompt).overall).toBe(false)
    expect(judge(fast, fast).overall).toBe(false)
  })
})
