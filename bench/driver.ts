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

import {
  docToScreen,
  type Engine,
  type FluidTick,
  type FrameTiming,
  type SceneCommand,
} from "../engine"
import { DEFAULT_FLUID } from "../engine/brush/brush"
import { BLOT_BRUSHES } from "../engine/brush/presets"
import {
  createVectorWorkload,
  type VectorWorkloadOptions,
} from "./vector-workload"
import { createWorkload, type WorkloadOptions } from "./workload"

/** The blot the benchmark blots with: the Tissue's (fluid brushes 17). */
const TISSUE = BLOT_BRUSHES.find((brush) => brush.name === "Tissue")!

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
  /**
   * Textures and buffers created while the pen is down. D30 allows the
   * stroke path none, with one sanctioned exception: a direct stroke's
   * cancel tiles are kept in pages, and a stroke that outgrows its pages
   * creates another (smudge 06). So this is zero for a dry brush and the
   * page count for smudge and wet brushes, and never grows with the dabs.
   */
  allocations: number
  /**
   * Textures and buffers created from each pen-down to the frame the stroke's
   * tail lands in, the pen by then up. A frame that needs a page is counted
   * in `allocations` only if it is drawn before the pen lifts, which is a speed: a slow
   * GPU draws a short stroke whole in the frame after, and counts none of its
   * pages. This counts them wherever the frame fell, so it is the number to
   * ask how many pages a run made. History's readback buffer is made as that
   * frame ends and is not among them: `readbacksTotal` counts it.
   */
  strokeAllocations: number
  /**
   * The largest buffer mapped for reading over the run, in bytes: history's
   * readback of a stroke, which is as large as the tiles it asks for (live
   * brushes 30).
   */
  readbackBytes: number
  /**
   * Milliseconds from each pen-up to history having put that stroke away,
   * where the pen waits for it: unwaited, the stroke after is being recorded
   * by then and the two are not told apart, so there are none.
   */
  historySettledMs: number[]
  /**
   * Milliseconds from undo being pressed after each stroke to the step
   * having been taken back, where the workload presses it (live brushes 32).
   */
  undoMs: number[]
  /**
   * Each frame of the fluid simulation's clock from the first pen-down to
   * the last stroke landing: the steps it ran and those its budget skipped
   * (fluid brushes 13), and whether the pen was down. Empty with nothing
   * wet.
   */
  fluidTicks: (FluidTick & { penDown: boolean })[]
  /** Wall-clock milliseconds the pen was down. */
  elapsedMs: number
  /**
   * Where in `frames` each stroke began: the first frame at or after one that
   * consumed a sample is the frame its pen-down was drawn in, and whatever a
   * stroke does once at its start is in that frame's pen-to-pixel.
   */
  strokeStarts: number[]
}

/** How wide the canvas is shown, in CSS pixels: a window onto a large document. */
const VIEWPORT = 800

/** Milliseconds of stillness between strokes, so the loop can wind down. */
const BETWEEN_STROKES = 120

/**
 * The wet sweep's brush (live brushes 10, 11), where the workload names no
 * spacing of its own: an eighth of the diameter between dabs, laying thinly
 * so what is underneath shows through and mixes.
 */
const WET_BRUSH = { spacing: 0.125, flow: 0.3 }

/** Frames in the fluid sweep's tip, and its size along a side. */
const FLUID_TIP_FRAMES = 4
const FLUID_TIP_SIZE = 64

/**
 * The fluid sweep's tip (fluid brushes 10): soft blobs off the middle, a
 * different one each frame, so a dab's shape is a texture read and its frame
 * changes from dab to dab.
 */
function fluidTip() {
  const size = FLUID_TIP_SIZE
  const data = new Uint8Array(FLUID_TIP_FRAMES * size * size)
  for (let frame = 0; frame < FLUID_TIP_FRAMES; frame++) {
    const turn = (frame / FLUID_TIP_FRAMES) * Math.PI * 2
    const cx = size / 2 + Math.cos(turn) * size * 0.15
    const cy = size / 2 + Math.sin(turn) * size * 0.15
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const reach = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / (size * 0.3)
        data[(frame * size + y) * size + x] =
          255 * Math.max(0, 1 - reach * reach)
      }
  }
  return { width: size, height: size, frameCount: FLUID_TIP_FRAMES, data }
}

/**
 * A fluid brush at its most for a step: as much water as a dab lays, none of
 * it drying while measured, and bleed, rim and granulation all at one.
 */
const FLOOD_FLUID = { water: 1, drying: 0, bleed: 1, edge: 1, granulation: 1 }

/** The flood's dab radius, and the rows it is laid along, in pixels. */
const FLOOD_RADIUS = 8

/**
 * Floods the whole document with fluid paint, the worst case a step of the
 * simulation meets (fluid brushes 13): every cell wet, and small dabs each a
 * hue of its own, so a cell's neighbours hold another colour and pigment
 * crossing between them is mixed, not added. On a document a whole number
 * of tiles a side every tile holds a slot, and none is a dry ring.
 */
async function floodFluid(
  engine: Engine,
  paint: (type: string, x: number, y: number) => void,
  width: number,
  height: number
): Promise<void> {
  await engine.dispatch({ type: "setColor", hex: "#e04030" })
  await engine.dispatch({
    type: "setBrush",
    radius: FLOOD_RADIUS,
    spacing: 0.25,
    flow: 1,
    fluid: FLOOD_FLUID,
    color: { hue: 1, saturation: 1, lightness: 1 },
    dynamics: [
      { source: "random", target: "hue", range: [-0.5, 0.5], mix: "add" },
      { source: "random", target: "lightness", range: [-0.3, 0.3], mix: "add" },
    ],
  })
  // One stroke, back and forth along rows a radius apart, a sample every
  // few dabs: the resampler lays the dabs between.
  const reach = FLOOD_RADIUS * 4
  let sent = 0
  paint("pointerdown", 0, 0)
  for (let row = 0, y = 0; y <= height; row++, y += FLOOD_RADIUS)
    for (let along = 0; along <= width; along += reach) {
      const x = row % 2 === 0 ? along : width - along
      paint("pointerrawupdate", x, y)
      paint("pointermove", x, y)
      if (++sent % 64 === 0) await nextFrame()
    }
  paint("pointerup", 0, height)
  await nextFrame()
  await nextFrame()
  await engine.dispatch({
    type: "setBrush",
    color: { hue: 0, saturation: 0, lightness: 0 },
    dynamics: [],
  })
}

export type FluidStepResult = {
  canvas: { width: number; height: number }
  /** Milliseconds a step of the simulation took, one figure per round. */
  stepMs: number[]
}

/** Steps timed in a round, and the rounds, unless told fewer. */
const STEPS_PER_ROUND = 120
const STEP_ROUNDS = 7

/**
 * What a step of the fluid simulation costs over a flooded document (fluid
 * brushes 13): every tile of it wet, worst case. Steps are run by command,
 * a round at a time, timed from the queue being empty to it being empty
 * again, a fence and no readback. Each step is a submission of its own, as
 * the engine's clock submits them.
 */
export async function runFluidStepBenchmark(
  engine: Engine,
  canvas: HTMLCanvasElement,
  size: { width: number; height: number },
  /** Fewer, for a software GPU that only checks the plumbing. */
  rounds: { steps: number; count: number } = {
    steps: STEPS_PER_ROUND,
    count: STEP_ROUNDS,
  }
): Promise<FluidStepResult> {
  canvas.style.width = `${VIEWPORT}px`
  canvas.style.height = `${(VIEWPORT * size.height) / size.width}px`
  await engine.dispatch({ type: "resize", ...size, devicePixelRatio: 1 })
  await engine.dispatch({ type: "initialize" })
  await engine.dispatch({ type: "setStabilization", strength: 0 })
  // The engine's queue, caught as it submits: the page is not handed it.
  const queues = new Set<GPUQueue>()
  const submit = GPUQueue.prototype.submit
  GPUQueue.prototype.submit = function (...args: Parameters<typeof submit>) {
    queues.add(this)
    return submit.apply(this, args)
  }
  const fence = () => [...queues][0].onSubmittedWorkDone()
  const bounds = canvas.getBoundingClientRect()
  const paint = (type: string, x: number, y: number) =>
    canvas.dispatchEvent(
      new PointerEvent(type, {
        pointerId: 1,
        pointerType: "pen",
        isPrimary: true,
        bubbles: true,
        cancelable: true,
        clientX: bounds.left + (x * bounds.width) / canvas.width,
        clientY: bounds.top + (y * bounds.height) / canvas.height,
        pressure: 1,
      })
    )
  try {
    await floodFluid(engine, paint, size.width, size.height)
    if (!engine.getSnapshot().wet) throw new Error("The flood is not wet.")
    // Warm: the pipelines are made and the flood has spread over its first
    // steps, where a cell's water is still finding its level.
    await engine.dispatch({ type: "advanceFluid", steps: rounds.steps })
    await fence()
    const stepMs: number[] = []
    for (let round = 0; round < rounds.count; round++) {
      const started = performance.now()
      await engine.dispatch({ type: "advanceFluid", steps: rounds.steps })
      await fence()
      stepMs.push((performance.now() - started) / rounds.steps)
    }
    if (!engine.getSnapshot().wet) throw new Error("The flood dried.")
    const { width, height } = engine.getSnapshot()
    return { canvas: { width, height }, stepMs }
  } finally {
    GPUQueue.prototype.submit = submit
  }
}

const nextFrame = () =>
  new Promise<number>((resolve) => requestAnimationFrame(resolve))

/**
 * Counts every call that could pull pixels back across the bus, for as long as
 * the run lasts, and separately those that happen while the pen is down; and,
 * while it is down, every texture and buffer created, and again until the
 * stroke has landed.
 * Patched rather than inspected: the claim is about what the engine does while
 * painting, and only running it can settle that.
 */
function watchInteractivePath(): {
  count: () => number
  total: () => number
  allocations: () => number
  strokeAllocations: () => number
  readbackBytes: () => number
  /** Called as the pen goes down and comes up: what makes the path the interactive one. */
  setPenDown: (down: boolean) => void
  /** Called once the frame a stroke's tail lands in has been drawn. */
  strokeLanded: () => void
  restore: () => void
} {
  let count = 0
  let total = 0
  let allocations = 0
  let strokeAllocations = 0
  let readbackBytes = 0
  let penDown = false
  let landing = false
  const buffer = GPUBuffer.prototype
  const encoder = GPUCommandEncoder.prototype
  const device = GPUDevice.prototype
  const mapAsync = buffer.mapAsync
  const copyTextureToBuffer = encoder.copyTextureToBuffer
  const createTexture = device.createTexture
  const createBuffer = device.createBuffer
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
  device.createTexture = function (...args: Parameters<typeof createTexture>) {
    if (penDown) allocations++
    if (landing) strokeAllocations++
    return createTexture.apply(this, args)
  }
  device.createBuffer = function (...args: Parameters<typeof createBuffer>) {
    if (penDown) allocations++
    if (args[0].usage & GPUBufferUsage.MAP_READ)
      readbackBytes = Math.max(readbackBytes, args[0].size)
    // History's readback of the stroke is made as its tail lands, and is
    // not the stroke's own.
    else if (landing) strokeAllocations++
    return createBuffer.apply(this, args)
  }
  return {
    count: () => count,
    total: () => total,
    allocations: () => allocations,
    strokeAllocations: () => strokeAllocations,
    readbackBytes: () => readbackBytes,
    setPenDown(down) {
      penDown = down
      if (down) landing = true
    },
    strokeLanded() {
      landing = false
    },
    restore() {
      buffer.mapAsync = mapAsync
      encoder.copyTextureToBuffer = copyTextureToBuffer
      device.createTexture = createTexture
      device.createBuffer = createBuffer
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
  const windowSize = options.viewport ?? {
    width: workload.width,
    height: workload.height,
  }
  canvas.style.width = `${VIEWPORT}px`
  canvas.style.height = `${(VIEWPORT * windowSize.height) / windowSize.width}px`
  await engine.dispatch({
    type: "resize",
    width: windowSize.width,
    height: windowSize.height,
    devicePixelRatio: 1,
  })
  await engine.dispatch({ type: "initialize" })
  if (options.viewport) await engine.dispatch({ type: "fitView" })
  if (options.colourDynamics) {
    await engine.dispatch({ type: "setColor", hex: "#e04030" })
    await engine.dispatch({
      type: "setBrush",
      color: { hue: 1, saturation: 1, lightness: 1 },
      dynamics: [
        { source: "random", target: "hue", range: [-0.25, 0.25], mix: "add" },
        {
          source: "random",
          target: "saturation",
          range: [-0.5, 0.5],
          mix: "add",
        },
        {
          source: "random",
          target: "lightness",
          range: [-0.25, 0.25],
          mix: "add",
        },
      ],
    })
  }
  const snapshot = engine.getSnapshot()
  if (snapshot.status !== "ready")
    throw new Error(`The engine is ${snapshot.status}, not ready.`)

  // Document pixels to client pixels, through the view. Strokes authored
  // across the whole document are painted across the whole document — the
  // point of measuring at full size — however small the window shows it.
  const bounds = canvas.getBoundingClientRect()
  const toScreen = docToScreen(
    snapshot.view,
    { width: snapshot.width, height: snapshot.height },
    { width: canvas.width, height: canvas.height }
  )
  const toClientX = (x: number) =>
    bounds.left + (x * bounds.width) / canvas.width
  const toClientY = (y: number) =>
    bounds.top + (y * bounds.height) / canvas.height
  const docToClientX = (x: number, y: number) =>
    toClientX(toScreen[0] * x + toScreen[2] * y + toScreen[4])
  const docToClientY = (x: number, y: number) =>
    toClientY(toScreen[1] * x + toScreen[3] * y + toScreen[5])

  // A fitted view is unrotated, so each axis maps on its own.
  await buildLayerStack(engine, canvas, workload.options.layers ?? 1, {
    toClientX: (x) => docToClientX(x, 0),
    toClientY: (y) => docToClientY(0, y),
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
  const scatter = workload.options.scatter
  if (scatter) await engine.dispatch({ type: "setBrush", scatter })
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
        clientX: docToClientX(sample.x, sample.y),
        clientY: docToClientY(sample.x, sample.y),
        pressure: sample.pressure,
        tiltX: sample.tiltX,
        tiltY: sample.tiltY,
      })
    )
  }

  const wet = workload.options.wet
  if (wet) {
    // The ground is laid with the brush itself, dry, so a dab of any size
    // has paint under the whole of it to pick up.
    await engine.dispatch({ type: "setColor", hex: "#0000ff" })
    await engine.dispatch({
      type: "setBrush",
      radius: wet.diameter / 2,
      spacing: wet.spacing ?? WET_BRUSH.spacing,
      flow: WET_BRUSH.flow,
    })
  }
  if (workload.options.smudge || wet) {
    // Paint to smear, laid before anything is timed or counted: a frame's
    // worth of samples at a time, so none are dropped on the way in.
    for (const stroke of workload.strokes) {
      dispatch("pointerdown", stroke.samples[0])
      for (let next = 1; next < stroke.samples.length; next++) {
        dispatch("pointerrawupdate", stroke.samples[next])
        dispatch("pointermove", stroke.samples[next])
        if (next % 16 === 0) await nextFrame()
      }
      dispatch("pointerup", stroke.samples[stroke.samples.length - 1])
      await nextFrame()
      await nextFrame()
    }
    await engine.save()
    if (wet) {
      if (wet.sampleAllLayers) {
        await engine.dispatch({ type: "addLayer" })
        await engine.dispatch({ type: "setSampleAllLayers", enabled: true })
      }
      await engine.dispatch({ type: "setColor", hex: "#ffff00" })
      // After the ground, which is laid solid whatever is painted over it.
      if (wet.scatter)
        await engine.dispatch({ type: "setBrush", scatter: wet.scatter })
      if (!wet.dry)
        await engine.dispatch({
          type: "setBrush",
          wet: { pickup: wet.pickup },
          flow: wet.flow ?? WET_BRUSH.flow,
        })
    } else {
      await engine.dispatch({ type: "setTool", tool: "smudge" })
      if (workload.options.smudgeRadius !== undefined)
        await engine.dispatch({
          type: "setSmudge",
          radius: workload.options.smudgeRadius,
        })
    }
  }
  const fluid = workload.options.fluid
  if (fluid?.flooded)
    await floodFluid(
      engine,
      (type, x, y) => dispatch(type, { x, y, pressure: 1, tiltX: 0, tiltY: 0 }),
      workload.width,
      workload.height
    )
  if (fluid) {
    if (fluid.tip)
      await engine.dispatch({
        type: "registerTexture",
        id: "bench-fluid-tip",
        texture: fluidTip(),
      })
    await engine.dispatch({
      type: "setBrush",
      radius: fluid.diameter / 2,
      spacing: fluid.spacing ?? WET_BRUSH.spacing,
      flow: WET_BRUSH.flow,
      ...(fluid.tip ? { tipTextureId: "bench-fluid-tip" } : {}),
      ...(fluid.scatter ? { scatter: fluid.scatter } : {}),
      ...(fluid.dry
        ? {}
        : fluid.blot
          ? { fluid: null, blot: TISSUE.rendering.blot }
          : { fluid: DEFAULT_FLUID }),
    })
  }
  const detachThumbnails = attachThumbnails(engine)

  const frames: FrameTiming[] = []
  engine.observeFrames((frame) => frames.push(frame))
  const fluidTicks: (FluidTick & { penDown: boolean })[] = []
  let penIsDown = false
  engine.observeFluid((tick) =>
    fluidTicks.push({ ...tick, penDown: penIsDown })
  )
  const watch = watchInteractivePath()
  const pump = createPump()
  let dispatched = 0
  const strokeStarts: number[] = []
  const settling: Promise<number>[] = []
  const undoMs: number[] = []
  const started = performance.now()

  try {
    for (const stroke of workload.strokes) {
      // History captures the previous mark after pen-up, on a later frame.
      // Wait for it before counting the next pen-down or a slow GPU makes
      // that prior mark's readback look like an interactive one. Unwaited,
      // it is one: the row is what history costs the stroke after it.
      if (dispatched > 0 && !workload.options.unwaited) await engine.save()
      if (workload.options.pauseMs)
        await new Promise((resolve) =>
          setTimeout(resolve, workload.options.pauseMs)
        )
      const [first] = stroke.samples
      watch.setPenDown(true)
      penIsDown = true
      strokeStarts.push(frames.length)
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
      watch.setPenDown(false)
      penIsDown = false
      const penUp = performance.now()
      // Two frames: one flushes the tail and composites the stroke, and the
      // loop has stopped by the end of the next.
      await nextFrame()
      // The engine asked for its frame before this one was, so the tail is in.
      watch.strokeLanded()
      await nextFrame()
      const undoAfter = workload.options.undoAfter
      if (undoAfter !== undefined) {
        if (undoAfter === "settled") await engine.save()
        else await new Promise((resolve) => setTimeout(resolve, undoAfter))
        const pressed = performance.now()
        await engine.dispatch({ type: "undo" })
        undoMs.push(performance.now() - pressed)
        // Put back, so the stroke after paints over what this one left.
        await engine.dispatch({ type: "redo" })
      }
      // The stroke is with history by now, so this waits for it and no less.
      else if (!workload.options.unwaited)
        settling.push(engine.save().then(() => performance.now() - penUp))
      await new Promise((resolve) => setTimeout(resolve, BETWEEN_STROKES))
    }
  } finally {
    engine.observeFrames(null)
    engine.observeFluid(null)
    detachThumbnails()
    pump.close()
    watch.restore()
  }

  // The last frame's timing is resolved on a GPU fence, so it may land a task
  // after the stroke ended.
  await nextFrame()
  const historySettledMs = await Promise.all(settling)
  const painted = engine.getSnapshot()
  return {
    frames,
    canvas: { width: painted.width, height: painted.height },
    dispatched,
    requested: workload.strokes.reduce(
      (total, stroke) => total + stroke.samples.length,
      0
    ),
    readbacks: watch.count(),
    readbacksTotal: watch.total(),
    allocations: watch.allocations(),
    strokeAllocations: watch.strokeAllocations(),
    readbackBytes: watch.readbackBytes(),
    historySettledMs,
    undoMs,
    fluidTicks,
    elapsedMs: performance.now() - started,
    strokeStarts,
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
