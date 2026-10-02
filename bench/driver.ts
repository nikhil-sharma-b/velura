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

import type { Engine, FrameTiming, SceneCommand } from "../engine"
import {
  createVectorWorkload,
  type VectorWorkloadOptions,
} from "./vector-workload"
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
   * counted while the pen is down. D30 forbids readback in the interactive
   * path outright, so the only defensible number here is zero. History reads
   * the tiles a mark landed in once the pen has lifted (D21), which is off
   * that path and counted separately.
   */
  readbacks: number
  /** Readbacks over the whole run, the pen-up ones included. */
  readbacksTotal: number
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
 * the run lasts, and separately those that happen while the pen is down.
 * Patched rather than inspected: the claim is about what the engine does while
 * painting, and only running it can settle that.
 */
function watchForReadback(): {
  count: () => number
  total: () => number
  /** Called as the pen goes down and comes up: what makes the path the interactive one. */
  setPenDown: (down: boolean) => void
  restore: () => void
} {
  let count = 0
  let total = 0
  let penDown = false
  const buffer = GPUBuffer.prototype
  const encoder = GPUCommandEncoder.prototype
  const mapAsync = buffer.mapAsync
  const copyTextureToBuffer = encoder.copyTextureToBuffer
  const record = () => {
    total++
    if (penDown) count++
  }
  buffer.mapAsync = function (...args: Parameters<typeof mapAsync>) {
    record()
    return mapAsync.apply(this, args)
  }
  encoder.copyTextureToBuffer = function (
    ...args: Parameters<typeof copyTextureToBuffer>
  ) {
    record()
    return copyTextureToBuffer.apply(this, args)
  }
  return {
    count: () => count,
    total: () => total,
    setPenDown(down) {
      penDown = down
    },
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

/** Canvas pixels to client pixels: the canvas is a window onto a larger document. */
export type ToClient = {
  toClientX: (x: number) => number
  toClientY: (y: number) => number
}

/**
 * One short mark on the active layer, drawn and composited, so the layer holds
 * pixels of its own. Exported because the compositor's browser tests need the
 * same thing and a second copy of it would drift.
 */
export async function markActiveLayer(
  canvas: HTMLCanvasElement,
  at: { x: number; y: number },
  toClient: ToClient
): Promise<void> {
  const event = (type: string, offset: number) =>
    canvas.dispatchEvent(
      new PointerEvent(type, {
        pointerId: 1,
        pointerType: "pen",
        isPrimary: true,
        bubbles: true,
        cancelable: true,
        clientX: toClient.toClientX(at.x + offset),
        clientY: toClient.toClientY(at.y),
        pressure: 0.7,
        tiltX: 0,
        tiltY: 0,
      })
    )
  event("pointerdown", 0)
  event("pointerrawupdate", 40)
  event("pointermove", 40)
  event("pointerup", 40)
  // One frame draws the mark, the next composites it into the layer.
  await nextFrame()
  await nextFrame()
}

/** The canvas as its own coordinate space, for a document shown at its own size. */
export function clientMapper(canvas: HTMLCanvasElement): ToClient {
  const bounds = canvas.getBoundingClientRect()
  return {
    toClientX: (x) => bounds.left + (x * bounds.width) / canvas.width,
    toClientY: (y) => bounds.top + (y * bounds.height) / canvas.height,
  }
}

/**
 * Builds the document the workload is painted on: `layers` layers, each with a
 * mark of its own so the compositor has something to flatten, and the pen left
 * on one in the middle of the stack — the arrangement with a cache on both
 * sides, which is the one the per-frame cost is a claim about (D19).
 *
 * Setup, not measurement: no frame is observed until this returns.
 */
export async function buildLayerStack(
  engine: Engine,
  canvas: HTMLCanvasElement,
  layers: number,
  toClient: ToClient = clientMapper(canvas)
): Promise<void> {
  if (layers <= 1) return
  const { width, height } = engine.getSnapshot()
  for (let i = 1; i < layers; i++) {
    await engine.dispatch({ type: "addLayer" })
    // Spread the marks down the canvas so the layers overlap partially rather
    // than stacking one identical mark, which a compositor could shortcut.
    await markActiveLayer(
      canvas,
      { x: width * 0.1, y: ((i + 1) / (layers + 1)) * height },
      toClient
    )
  }
  const stack = engine.getSnapshot().layers
  await engine.dispatch({
    type: "selectLayer",
    id: stack[stack.length >> 1].id,
  })
}

/**
 * Gives every layer a thumbnail, as the studio's layer list does, so what is
 * measured is the product's stack rather than one with its list folded away.
 * A thumbnail must cost a frame of drawing nothing; this is where that holds.
 */
function attachThumbnails(engine: Engine): () => void {
  const detach = engine.getSnapshot().layers.map((layer) => {
    const thumbnail = document.createElement("canvas")
    thumbnail.width = thumbnail.height = 64
    document.body.append(thumbnail)
    const stop = engine.attachThumbnail(layer.id, thumbnail)
    return () => {
      stop()
      thumbnail.remove()
    }
  })
  return () => detach.forEach((stop) => stop())
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

  await buildLayerStack(engine, canvas, workload.options.layers ?? 1, {
    toClientX,
    toClientY,
  })
  const feather = workload.options.feather
  if (feather !== undefined) {
    await engine.dispatch({
      type: "selectShape",
      shape: "ellipse",
      x: workload.width * 0.05,
      y: workload.height * 0.05,
      width: workload.width * 0.9,
      height: workload.height * 0.9,
    })
    await engine.dispatch({ type: "featherSelection", radius: feather })
  }
  const detachThumbnails = attachThumbnails(engine)

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
      // History captures the previous mark after pen-up, on a later frame.
      // Wait for it before counting the next pen-down or a slow GPU makes
      // that prior mark's readback look like an interactive one.
      if (dispatched > 0) await engine.save()
      const [first] = stroke.samples
      readback.setPenDown(true)
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
      readback.setPenDown(false)
      // Two frames: one flushes the tail and composites the stroke, and the
      // loop has stopped by the end of the next.
      await nextFrame()
      await nextFrame()
      await new Promise((resolve) => setTimeout(resolve, BETWEEN_STROKES))
    }
  } finally {
    engine.observeFrames(null)
    detachThumbnails()
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
    readbacksTotal: readback.total(),
    elapsedMs: performance.now() - started,
  }
}

export type VectorRunResult = {
  canvas: { width: number; height: number }
  objects: number
  /** Adding every object at once: tessellating them all, and the first draw. */
  firstDrawMs: number
  /** Edits spanning the layer, each redrawing every object in it. */
  fullRedrawMs: number[]
  /** Edits to one object, each redrawing only the region it touched. */
  localRedrawMs: number[]
  /**
   * Pans and zooms at high magnification, each drawing the layer from its
   * geometry into the screen (sharp-zoom 02), command to GPU done.
   */
  navigateMs: number[]
}

/** Redraws timed per edit; few enough to keep a large scene's run short. */
const VECTOR_REDRAWS = 20

/**
 * Re-rasterising a vector layer (19), timed from the edit being sent to the
 * GPU reporting the work done — a fence, as the painting workload's latency
 * is, so nothing is read back to time it.
 */
export async function runVectorBenchmark(
  engine: Engine,
  canvas: HTMLCanvasElement,
  options: VectorWorkloadOptions
): Promise<VectorRunResult> {
  const { objects } = createVectorWorkload(options)
  canvas.style.width = `${VIEWPORT}px`
  canvas.style.height = `${VIEWPORT}px`
  await engine.dispatch({
    type: "resize",
    width: options.width,
    height: options.height,
    devicePixelRatio: 1,
  })
  await engine.dispatch({ type: "initialize" })
  if (engine.getSnapshot().status !== "ready")
    throw new Error(`The engine is ${engine.getSnapshot().status}, not ready.`)
  const device = (
    canvas.getContext("webgpu") as GPUCanvasContext | null
  )?.getConfiguration()?.device
  if (!device) throw new Error("The engine's device could not be reached.")
  await engine.dispatch({ type: "addVectorLayer" })
  const id = engine.getSnapshot().activeLayerId
  const timed = async (commands: SceneCommand[]) => {
    await device.queue.onSubmittedWorkDone()
    const start = performance.now()
    await engine.dispatch({ type: "editVectorLayer", id, commands })
    await device.queue.onSubmittedWorkDone()
    return performance.now() - start
  }
  const firstDrawMs = await timed(
    objects.map((object) => ({ type: "add", object }))
  )
  const backdrop = objects[0]
  const fullRedrawMs: number[] = []
  for (let i = 0; i < VECTOR_REDRAWS; i++)
    fullRedrawMs.push(
      await timed([
        {
          type: "update",
          id: backdrop.id,
          patch: {
            style: {
              ...backdrop.style,
              fill: { ...backdrop.style.fill!, opacity: i % 2 ? 1 : 0.9 },
            },
          },
        },
      ])
    )
  const moved = objects[objects.length >> 1]
  const localRedrawMs: number[] = []
  for (let i = 0; i < VECTOR_REDRAWS; i++)
    localRedrawMs.push(
      await timed([
        {
          type: "update",
          id: moved.id,
          patch: { transform: [1, 0, 0, 1, i % 2 ? 0 : 12, 0] },
        },
      ])
    )
  // Magnified past the layer's pixels, where the screen draws its paths
  // through the view rather than sampling them; then navigated as the
  // navigation workload is.
  await engine.dispatch({ type: "zoomView", factor: 8 })
  await nextFrame()
  await device.queue.onSubmittedWorkDone()
  const navigateMs: number[] = []
  for (let i = 0; i < NAVIGATION_STEPS; i++) {
    const frameStart = nextFrame().then(() => performance.now())
    await engine.dispatch(
      i % 2
        ? { type: "panView", dx: i % 4 === 1 ? 37 : -37, dy: 11 }
        : { type: "zoomView", factor: i % 4 === 0 ? 1.25 : 0.8 }
    )
    const start = await frameStart
    await new Promise((resolve) => setTimeout(resolve, 0))
    await device.queue.onSubmittedWorkDone()
    navigateMs.push(performance.now() - start)
  }
  const { width, height } = engine.getSnapshot()
  return {
    canvas: { width, height },
    objects: objects.length,
    firstDrawMs,
    fullRedrawMs,
    localRedrawMs,
    navigateMs,
  }
}

export type NavigationRunResult = {
  canvas: { width: number; height: number }
  viewport: { width: number; height: number }
  layers: number
  /** Each step of a pan or zoom, from its frame starting to the GPU done drawing it. */
  frameMs: number[]
}

/** Steps of navigation timed; a pan and a zoom in turn. */
const NAVIGATION_STEPS = 60

/**
 * Navigating a stack (sharp-zoom 01): the screen is composited at its own
 * resolution through the view, so every pan and zoom rebuilds the caches
 * around the active layer — one draw per layer at the window's size. Each
 * step is timed from the command to the GPU finishing the frame that shows
 * it, a fence rather than a readback.
 */
export async function runNavigationBenchmark(
  engine: Engine,
  canvas: HTMLCanvasElement,
  options: { width: number; height: number; layers: number }
): Promise<NavigationRunResult> {
  canvas.style.width = `${VIEWPORT}px`
  canvas.style.height = `${VIEWPORT}px`
  await engine.dispatch({
    type: "resize",
    width: options.width,
    height: options.height,
    devicePixelRatio: 1,
  })
  await engine.dispatch({ type: "initialize" })
  if (engine.getSnapshot().status !== "ready")
    throw new Error(`The engine is ${engine.getSnapshot().status}, not ready.`)
  const device = (
    canvas.getContext("webgpu") as GPUCanvasContext | null
  )?.getConfiguration()?.device
  if (!device) throw new Error("The engine's device could not be reached.")
  await buildLayerStack(engine, canvas, options.layers)
  await engine.dispatch({ type: "zoomView", factor: 2 })
  await nextFrame()
  await device.queue.onSubmittedWorkDone()
  const frameMs: number[] = []
  for (let i = 0; i < NAVIGATION_STEPS; i++) {
    // Requested before the command, so it runs first in the frame that draws
    // it: the wait for that frame is the display's, not the compositor's.
    const frameStart = nextFrame().then(() => performance.now())
    await engine.dispatch(
      i % 2
        ? { type: "panView", dx: i % 4 === 1 ? 37 : -37, dy: 11 }
        : { type: "zoomView", factor: i % 4 === 0 ? 1.25 : 0.8 }
    )
    const start = await frameStart
    // After the frame's callbacks, the engine's drawing among them, have run.
    await new Promise((resolve) => setTimeout(resolve, 0))
    await device.queue.onSubmittedWorkDone()
    frameMs.push(performance.now() - start)
  }
  const { width, height } = engine.getSnapshot()
  return {
    canvas: { width, height },
    viewport: { width: canvas.width, height: canvas.height },
    layers: engine.getSnapshot().layers.length,
    frameMs,
  }
}
