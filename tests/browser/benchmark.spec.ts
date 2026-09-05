import { expect, test } from "@playwright/test"
import { summarize } from "../../bench/report"

/**
 * The benchmark's plumbing, checked on the software rasterizer the suite runs
 * on. Nothing here asserts a speed — SwiftShader has no opinion worth having
 * about the target — but a benchmark that silently stopped driving the engine,
 * or stopped observing frames, would report excellent numbers for no work at
 * all, and that is worth catching in CI.
 */
const WORKLOAD = {
  width: 512,
  height: 512,
  // Three short strokes rather than two: the frame counts below are what say
  // the loop ran at all, and two strokes on a loaded machine land close enough
  // to the floor to fail for scheduling reasons rather than for engine ones.
  strokes: 3,
  sampleRateHz: 240,
  penSpeed: 900,
  seed: 3,
}

test("the benchmark drives the engine and observes every frame", async ({
  page,
}) => {
  test.setTimeout(60_000)
  await page.goto("http://127.0.0.1:3101/tests/harness/")
  await page.waitForFunction(() => !!window.runBenchmark)
  const result = await page.evaluate(
    (workload) => window.runBenchmark(workload),
    WORKLOAD
  )

  // Every sample the workload asked for reached the canvas as a pointer event.
  expect(result.dispatched).toBe(result.requested)
  expect(result.canvas).toEqual({ width: 512, height: 512 })
  // Frames were observed, and they drew: a run reporting no dabs is measuring
  // an engine that never got the pen.
  expect(result.frames.length).toBeGreaterThan(10)
  expect(
    result.frames.reduce((total, frame) => total + frame.stamps, 0)
  ).toBeGreaterThan(50)
  // Pen-to-pixel was measured on the frames that consumed a sample.
  const timed = result.frames.filter((frame) => frame.latencyMs !== null)
  expect(timed.length).toBeGreaterThan(5)
  for (const frame of timed) expect(frame.latencyMs).toBeGreaterThan(0)

  // D30's hard rule, checked while painting rather than by reading the source.
  expect(result.readbacks).toBe(0)

  // And the records summarize into a report, which is what gets recorded.
  const report = summarize(result.frames, { warmupFrames: 0 })
  expect(report.frames).toBe(result.frames.length)
  expect(report.stamps.total).toBeGreaterThan(50)
  expect(report.latencyMs.samples).toBe(timed.length)
})

test("observing frames is opt-in and detaches cleanly", async ({ page }) => {
  await page.goto("http://127.0.0.1:3101/tests/harness/")
  await page.waitForFunction(() => !!window.engine)
  const seen = await page.evaluate(async () => {
    window.remountEngine()
    await window.engine.dispatch({
      type: "resize",
      width: 200,
      height: 120,
      devicePixelRatio: 1,
    })
    await window.engine.dispatch({ type: "initialize" })
    let count = 0
    window.engine.observeFrames(() => count++)
    const canvas = document.querySelector("canvas")!
    const bounds = canvas.getBoundingClientRect()
    const move = (type: string, x: number) =>
      canvas.dispatchEvent(
        new PointerEvent(type, {
          pointerId: 1,
          pointerType: "pen",
          isPrimary: true,
          bubbles: true,
          clientX: bounds.left + x,
          clientY: bounds.top + 40,
          pressure: 0.6,
        })
      )
    move("pointerdown", 20)
    for (let x = 24; x <= 120; x += 8) {
      move("pointerrawupdate", x)
      move("pointermove", x)
      await new Promise((resolve) => requestAnimationFrame(resolve))
    }
    move("pointerup", 120)
    await new Promise((resolve) => requestAnimationFrame(resolve))
    await new Promise((resolve) => requestAnimationFrame(resolve))
    const observed = count
    window.engine.observeFrames(null)
    count = 0
    move("pointerdown", 20)
    move("pointerup", 20)
    await new Promise((resolve) => requestAnimationFrame(resolve))
    await new Promise((resolve) => requestAnimationFrame(resolve))
    return { observed, afterDetach: count }
  })
  expect(seen.observed).toBeGreaterThan(3)
  expect(seen.afterDetach).toBe(0)
})
