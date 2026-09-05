/**
 * Driving the benchmark inside the page (D30).
 *
 * The pen is synthetic but nothing else is: samples are dispatched as pointer
 * events on the engine's own canvas, so the run goes through the sampler, the
 * ring buffer, the stabilizer, the resampler, the dynamics graph, the stroke
 * buffer and the display transform — the shipped path, not a rehearsal of it.
 * A benchmark that called the renderer directly would measure a program nobody
 * runs.
 */

import type { Engine, FrameTiming } from "../engine"
import { createWorkload, type WorkloadOptions } from "./workload"

export type RunResult = {
  frames: FrameTiming[]
  /** The document actually painted: a device may cap below the asked-for size. */
  canvas: { width: number; height: number }
  /** Samples the driver dispatched, and how many the pen was asked for. */
  dispatched: number
  requested: number
  /**
   * Calls to the two WebGPU entry points that move pixels back to the CPU,
   * counted for the length of the run. D30 forbids readback in the interactive
   * path outright, so the only defensible number here is zero.
   */
  readbacks: number
  /** Wall-clock milliseconds the pen was down. */
  elapsedMs: number
}

/** How wide the canvas is shown, in CSS pixels: a window onto a large document. */
const VIEWPORT = 800

/** Milliseconds of stillness between strokes, so the loop can wind down. */
const BETWEEN_STROKES = 120

const nextFrame = () =>
  new Promise<number>((resolve) => requestAnimationFrame(resolve))

/**
 * Counts every call that could pull pixels back across the bus, for as long as
 * the run lasts. Patched rather than inspected: the claim is about what the
 * engine does while painting, and only running it can settle that.
 */
function watchForReadback(): { count: () => number; restore: () => void } {
  let count = 0
  const buffer = GPUBuffer.prototype
  const encoder = GPUCommandEncoder.prototype
  const mapAsync = buffer.mapAsync
  const copyTextureToBuffer = encoder.copyTextureToBuffer
  buffer.mapAsync = function (...args: Parameters<typeof mapAsync>) {
    count++
    return mapAsync.apply(this, args)
  }
  encoder.copyTextureToBuffer = function (
    ...args: Parameters<typeof copyTextureToBuffer>
  ) {
    count++
    return copyTextureToBuffer.apply(this, args)
  }
  return {
    count: () => count,
    restore() {
      buffer.mapAsync = mapAsync
      encoder.copyTextureToBuffer = copyTextureToBuffer
    },
  }
}

/**
 * A task pump that is not clamped to the timer's four-millisecond floor. A
 * 240 Hz pen reports every 4.17 ms and several samples land between frames;
 * pacing the pen off `setTimeout` would quantise it into the frame rate and
 * quietly measure a 60 Hz stylus.
 */
function createPump(): { post(task: () => void): void; close(): void } {
  const channel = new MessageChannel()
  let pending: (() => void) | null = null
  channel.port1.onmessage = () => {
    const task = pending
    pending = null
    task?.()
  }
  return {
    post(task) {
      pending = task
      channel.port2.postMessage(0)
    },
    close() {
      pending = null
      channel.port1.close()
      channel.port2.close()
    },
  }
}

/**
 * The display's refresh rate, measured. `requestAnimationFrame` cannot run
 * faster than the panel, so a 60 Hz monitor caps the benchmark at 60 fps
 * whatever the engine could do. Reading the frame rate without this alongside
 * it is how a display limit gets written up as an engine limit.
 */
export async function measureRefreshHz(samples = 60): Promise<number> {
  const intervals: number[] = []
  let previous = await nextFrame()
  for (let i = 0; i < samples; i++) {
    const now = await nextFrame()
    intervals.push(now - previous)
    previous = now
  }
  intervals.sort((a, b) => a - b)
  const median = intervals[intervals.length >> 1]
  return median > 0 ? 1000 / median : 0
}

export type Environment = {
  userAgent: string
  /**
   * The panel's rate, or null when it was not measured. Null on the unpaced
   * pass: with the frame-rate limit removed the number that comes back is the
   * loop's speed, not the display's, and recording it would be recording a
   * reading of nothing.
   */
  refreshHz: number | null
  adapter: Record<string, string> | null
  devicePixelRatio: number
}

/** What the run should be read against: the machine, not the code. */
export async function describeEnvironment(
  measureDisplay: boolean
): Promise<Environment> {
  const adapter = await navigator.gpu?.requestAdapter()
  const info = adapter?.info
  return {
    userAgent: navigator.userAgent,
    refreshHz: measureDisplay ? Math.round(await measureRefreshHz()) : null,
    adapter: info
      ? {
          vendor: info.vendor,
          architecture: info.architecture,
          device: info.device,
          description: info.description,
        }
      : null,
    devicePixelRatio: window.devicePixelRatio,
  }
}

export async function runBenchmark(
  engine: Engine,
  canvas: HTMLCanvasElement,
  options: WorkloadOptions
): Promise<RunResult> {
  const workload = createWorkload(options)
  canvas.style.width = `${VIEWPORT}px`
  canvas.style.height = `${VIEWPORT}px`
  await engine.dispatch({
    type: "resize",
    width: workload.width,
    height: workload.height,
    devicePixelRatio: 1,
  })
  await engine.dispatch({ type: "initialize" })
  const snapshot = engine.getSnapshot()
  if (snapshot.status !== "ready")
    throw new Error(`The engine is ${snapshot.status}, not ready.`)

  // Canvas pixels to client pixels. The document is larger than its window, so
  // strokes authored across the whole document are painted across the whole
  // document — the point of measuring at full size.
  const bounds = canvas.getBoundingClientRect()
  const toClientX = (x: number) =>
    bounds.left + (x * bounds.width) / canvas.width
  const toClientY = (y: number) =>
    bounds.top + (y * bounds.height) / canvas.height

  const frames: FrameTiming[] = []
  engine.observeFrames((frame) => frames.push(frame))
  const readback = watchForReadback()
  const pump = createPump()
  let dispatched = 0
  const started = performance.now()

  const dispatch = (
    type: string,
    sample: {
      x: number
      y: number
      pressure: number
      tiltX: number
      tiltY: number
    }
  ) => {
    canvas.dispatchEvent(
      new PointerEvent(type, {
        pointerId: 1,
        pointerType: "pen",
        isPrimary: true,
        bubbles: true,
        cancelable: true,
        clientX: toClientX(sample.x),
        clientY: toClientY(sample.y),
        pressure: sample.pressure,
        tiltX: sample.tiltX,
        tiltY: sample.tiltY,
      })
    )
  }

  try {
    for (const stroke of workload.strokes) {
      const [first] = stroke.samples
      dispatch("pointerdown", first)
      dispatched++
      // The pen's clock starts now, and every sample is dispatched when it is
      // due rather than as fast as the loop can go: a benchmark that fired the
      // whole stroke in one task would measure a batch, not a hand.
      const penDown = performance.now()
      await new Promise<void>((resolve) => {
        let next = 1
        const step = () => {
          const elapsed = performance.now() - penDown
          while (
            next < stroke.samples.length &&
            stroke.samples[next].time <= elapsed
          ) {
            dispatch("pointerrawupdate", stroke.samples[next])
            dispatch("pointermove", stroke.samples[next])
            dispatched++
            next++
          }
          if (next >= stroke.samples.length) resolve()
          else pump.post(step)
        }
        pump.post(step)
      })
      dispatch("pointerup", stroke.samples[stroke.samples.length - 1])
      // Two frames: one flushes the tail and composites the stroke, and the
      // loop has stopped by the end of the next.
      await nextFrame()
      await nextFrame()
      await new Promise((resolve) => setTimeout(resolve, BETWEEN_STROKES))
    }
  } finally {
    engine.observeFrames(null)
    pump.close()
    readback.restore()
  }

  // The last frame's timing is resolved on a GPU fence, so it may land a task
  // after the stroke ended.
  await nextFrame()
  const painted = engine.getSnapshot()
  return {
    frames,
    canvas: { width: painted.width, height: painted.height },
    dispatched,
    requested: workload.strokes.reduce(
      (total, stroke) => total + stroke.samples.length,
      0
    ),
    readbacks: readback.count(),
    elapsedMs: performance.now() - started,
  }
}
