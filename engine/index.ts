import {
  type Brush,
  type BrushGrain,
  brushSpacing,
  cloneBrush,
  DEFAULT_BRUSH,
} from "./brush/brush"
import {
  evaluateDynamics,
  type Modulator,
  NEUTRAL_STAMP_PARAMS,
  type StampParams,
  validateDynamics,
} from "./brush/dynamics"
import {
  type Accumulation,
  BRUSH_COLOR,
  BRUSH_FEATHER,
} from "./brush/round-brush"
import { createStampContextTracker } from "./brush/stamp-context"
import { createTextureLibrary } from "./brush/texture"
import {
  chooseOutputColorSpace,
  type OutputColorSpace,
} from "./color/display-transform"
import { BACKGROUND, createScene } from "./doc/scene"
import type { TiledLayer } from "./doc/tiled-layer"
import { createStrokeResampler } from "./geom/path"
import { createStabilizer } from "./geom/stabilizer"
import {
  createRenderer,
  MAX_STAMPS_PER_DRAW,
  type Renderer,
} from "./gpu/renderer"
import { STAMP, STAMP_STRIDE } from "./gpu/stamp-instance"
import { attachPointerSampler } from "./input/pointer-sampler"
import { createSampleBuffer } from "./input/sample-buffer"

/**
 * Two frames of the fastest plausible pen (240 Hz) plus slack. Overrunning
 * drops the oldest samples, which is the right loss: the stroke's head matters
 * more than a position two frames stale.
 */
const SAMPLE_CAPACITY = 512

/** A light default: enough to steady a hand, little enough to feel direct. */
export const DEFAULT_STABILIZATION = 0.2

export type EngineCommand =
  | { type: "initialize" }
  | { type: "resize"; width: number; height: number; devicePixelRatio: number }
  /** Stabilizer strength in [0, 1]; zero restores the raw unfiltered path. */
  | { type: "setStabilization"; strength: number }
  /**
   * The brush. Every field is optional and unnamed ones are left alone, so a
   * control that owns one property need not know the rest of the brush.
   */
  | {
      type: "setBrush"
      accumulation?: Accumulation
      opacity?: number
      flow?: number
      radius?: number
      /** Stamp spacing as a fraction of the dab diameter. */
      spacing?: number
      /** Width of the tip against its length, in (0, 1]. */
      roundness?: number
      /** Rotation of the tip, as a turn clockwise. */
      angle?: number
      /**
       * Greyscale tip texture, by id (D24). Null restores the procedural disc,
       * which is what makes the round brush reachable again from a textured one.
       */
      tipTextureId?: string | null
      /** The paper, by texture id, with its scale and depth. Null is smooth. */
      grain?: BrushGrain | null
      /** Replaces the dynamics graph outright; see `evaluateDynamics`. */
      dynamics?: Modulator[]
    }

export type EngineSnapshot = Readonly<{
  status:
    | "idle"
    | "initializing"
    | "ready"
    | "unavailable"
    | "failed"
    | "disposed"
  width: number
  height: number
  /** The colour space pixels are presented in: wide gamut where available. */
  outputColorSpace: OutputColorSpace
  /** Stabilizer strength in [0, 1]. Structural state, so React may see it. */
  stabilization: number
  /** The brush in the hand: serialisable data, never code (D23). */
  brush: Brush
  error: string | null
}>

/**
 * What a host shows before an engine exists. Exported so the React host and
 * the engine cannot drift apart on the shape or the defaults.
 */
export const INITIAL_SNAPSHOT: EngineSnapshot = Object.freeze({
  status: "idle",
  width: 1,
  height: 1,
  outputColorSpace: "srgb",
  stabilization: DEFAULT_STABILIZATION,
  brush: Object.freeze(cloneBrush(DEFAULT_BRUSH)),
  error: null,
})

export type RenderedPixels = {
  width: number
  height: number
  /** Display-encoded RGBA8, tightly packed, top row first. */
  data: Uint8Array
  /** The colour space `data` is encoded in. */
  colorSpace: OutputColorSpace
}

/**
 * What one frame of the interactive loop cost (D30). Emitted only while an
 * observer is attached, and only for frames the stroke loop actually ran:
 * nothing here is computed, allocated or awaited during ordinary painting.
 */
export type FrameTiming = {
  /** The frame callback's timestamp, on the page's clock. */
  start: number
  /** Main-thread milliseconds spent draining, stamping and submitting. */
  cpuMs: number
  /** Dabs stamped in this frame. */
  stamps: number
  /**
   * Pen-to-pixel, in milliseconds: from the event timestamp of the oldest
   * sample the frame consumed to the GPU reporting the frame's work done.
   * Null on a frame that consumed no sample. This is a fence, not a readback —
   * no pixel crosses back to the CPU (D30).
   */
  latencyMs: number | null
}

export interface Engine {
  dispatch(command: EngineCommand): Promise<void>
  getSnapshot(): EngineSnapshot
  subscribe(listener: () => void): () => void
  /** Explicit asynchronous readback for tests and future export; never per frame. */
  readPixels(): Promise<RenderedPixels>
  /**
   * Watches the cost of every frame of drawing, for the benchmark (D30). Null
   * detaches. Attaching one adds a promise per frame, so it is off by default
   * and never on in the product.
   */
  observeFrames(observer: ((frame: FrameTiming) => void) | null): void
  dispose(): void
}

/** A grain setting is input like any other brush field, so it is checked once. */
function validateGrain(grain: BrushGrain): void {
  if (typeof grain.textureId !== "string" || grain.textureId === "")
    throw new Error("Grain must name a texture.")
  if (!Number.isFinite(grain.scale) || grain.scale <= 0)
    throw new Error("Grain scale must be positive.")
  if (!Number.isFinite(grain.depth) || grain.depth < 0 || grain.depth > 1)
    throw new Error("Grain depth must be a finite value in [0, 1].")
}

/** Canvas attachment is a lifecycle operation; commands contain only values. */
export function createEngine(
  canvas: HTMLCanvasElement | OffscreenCanvas
): Engine {
  let snapshot: EngineSnapshot = INITIAL_SNAPSHOT
  const listeners = new Set<() => void>()
  let device: GPUDevice | undefined
  let context: GPUCanvasContext | null = null
  let format: GPUTextureFormat = "bgra8unorm"
  let initialization: Promise<void> | undefined
  let viewport = { width: 1, height: 1, devicePixelRatio: 1 }
  let renderer: Renderer | undefined
  let layer: TiledLayer | undefined
  let disposed = false

  // The stroke path. Every buffer here is allocated once, at construction:
  // a frame of drawing performs no allocation at all (D30).
  const samples = createSampleBuffer(SAMPLE_CAPACITY)
  const stabilizer = createStabilizer()
  // Rebuilt only when the brush changes its spacing, which never happens
  // inside a stroke: a frame of drawing still allocates nothing (D30).
  let resampler = createStrokeResampler(brushSpacing(DEFAULT_BRUSH))
  const dynamics = createStampContextTracker()
  // Ids in a brush are resolved here, so the brush stays data and the pixels
  // stay an asset (D24). Imported textures register into this same library.
  const textures = createTextureLibrary()
  const params: StampParams = { ...NEUTRAL_STAMP_PARAMS }
  // Evaluated once per stroke rather than per dab, so it is kept apart from
  // `params` instead of borrowing it and being overwritten by the first dab.
  const strokeParams: StampParams = { ...NEUTRAL_STAMP_PARAMS }
  const stamps = new Float32Array(MAX_STAMPS_PER_DRAW * STAMP_STRIDE)
  let stampCount = 0
  let stroking = false
  // The pen-down sample opens the path, and it arrives through the buffer like
  // every other sample: nothing is drawn from inside an event handler.
  let opening = false
  // Where the pen actually was, before stabilization pulled the path behind it,
  // and what it reported there: the tail flushed on pen-up reuses all of it.
  let rawX = 0
  let rawY = 0
  let rawPressure = 1
  let rawTiltX = 0
  let rawTiltY = 0
  let rawTime = 0
  // Mirrors the snapshot so the per-dab path reads plain fields off one object
  // rather than a frozen snapshot that is replaced on every publish.
  let brush = cloneBrush(DEFAULT_BRUSH)
  // Jitter is seeded per stroke, so a `random` mapping differs between marks
  // while any one mark stays reproducible — which is what lets a stroke be
  // replayed from the log identically (D26).
  let strokeSeed = 0
  // What the renderer was last told the brush's textures are. Undefined means
  // a renderer that has been told nothing, which a fresh one has not.
  let appliedTextures: string | undefined
  let frame: number | undefined
  let detachSampler: (() => void) | undefined
  // Frame instrumentation. All of it is inert until an observer is attached.
  let frameObserver: ((frame: FrameTiming) => void) | null = null
  /** The page clock reading that this stroke's sample times are relative to. */
  let strokeOrigin = 0
  let frameStamps = 0
  /** Event time of the oldest sample this frame drained, on the page's clock. */
  let frameOldestSample: number | null = null
  stabilizer.setStrength(DEFAULT_STABILIZATION)

  function publish(update: Partial<EngineSnapshot>) {
    const next = { ...snapshot, ...update }
    if (
      Object.keys(next).every(
        (key) =>
          next[key as keyof EngineSnapshot] ===
          snapshot[key as keyof EngineSnapshot]
      )
    )
      return
    snapshot = Object.freeze(next)
    listeners.forEach((listener) => listener())
  }

  function release() {
    if (frame !== undefined) cancelAnimationFrame(frame)
    frame = undefined
    stroking = false
    opening = false
    stampCount = 0
    samples.clear()
    renderer?.destroy()
    renderer = undefined
    layer = undefined
    context?.unconfigure()
    context = null
    device?.destroy()
    device = undefined
  }

  function fail(error: unknown) {
    if (disposed) return
    release()
    publish({
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    })
  }

  function resize() {
    const limit = device?.limits.maxTextureDimension2D ?? 8192
    const width = Math.max(1, viewport.width * viewport.devicePixelRatio)
    const height = Math.max(1, viewport.height * viewport.devicePixelRatio)
    // Scale both axes together when the backing store exceeds the device limit.
    const scale = Math.min(1, limit / width, limit / height)
    const pixelWidth = Math.max(1, Math.round(width * scale))
    const pixelHeight = Math.max(1, Math.round(height * scale))
    // Re-tiling and re-uploading the document is wasted work at the same size.
    if (
      layer &&
      pixelWidth === snapshot.width &&
      pixelHeight === snapshot.height
    )
      return
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight
    if (renderer) {
      // The document is authored in canvas pixels for now, so a resize
      // re-tiles it; sparse tiles make that cost what is actually covered.
      layer = createScene(pixelWidth, pixelHeight)
      renderer.resize(pixelWidth, pixelHeight)
      renderer.upload(layer)
    }
    publish({ width: pixelWidth, height: pixelHeight })
  }

  /**
   * Collects one dab, drawing early if the instance buffer would overflow.
   *
   * This is where the dynamics graph (D23) meets the renderer: the pen state
   * interpolated to this dab becomes a stamp context, the graph turns that
   * into a modulation, and the modulation scales the brush's own radius and
   * flow. Targets the stamp cannot yet express — tip angle, grain, scatter —
   * are evaluated all the same and land when their renderers do (D24).
   */
  function emitStamp(
    x: number,
    y: number,
    pressure: number,
    tiltX: number,
    tiltY: number,
    time: number
  ) {
    // The tracker was opened by the pen going down, so every dab advances it:
    // the first one has not moved from that point and so has no speed yet.
    const context = dynamics.next(x, y, pressure, tiltX, tiltY, time)
    evaluateDynamics(brush.dynamics, context, params)
    if (stampCount === MAX_STAMPS_PER_DRAW) flushStamps()
    const offset = stampCount * STAMP_STRIDE
    stamps[offset + STAMP.CENTER_X] = x
    stamps[offset + STAMP.CENTER_Y] = y
    stamps[offset + STAMP.RADIUS] = brush.shape.radius * params.size
    // Flow: the dab's own opacity, not the stroke's, which is applied once
    // when the buffer is composited (D27).
    stamps[offset + STAMP.OPACITY] = brush.rendering.flow * params.flow
    // Angle offsets the brush's own rotation and roundness scales its own
    // squash, which is what lets one dynamics list read the same on any tip.
    stamps[offset + STAMP.ANGLE] = brush.shape.angle + params.angle
    stamps[offset + STAMP.ROUNDNESS] = brush.shape.roundness * params.roundness
    // The brush's own grain depth is in the uniform; this is what the graph
    // does to it per dab, so a light touch can skim the paper (D24).
    stamps[offset + STAMP.GRAIN_DEPTH] = params.grainDepth
    stampCount++
    frameStamps++
  }

  /**
   * Hands the renderer the pixels behind the brush's texture ids. Called when
   * the brush changes and when a renderer is created, since a renderer starts
   * with no textures and the brush may already name some.
   */
  function applyBrushTextures() {
    if (!renderer) return
    const grain = brush.grain
    // Uploading a texture and rebuilding a bind group is real work, and
    // `setBrush` is what a dragged slider calls: a radius that changed must
    // not re-upload the paper the brush was already drawing on.
    const key = `${brush.shape.tipTextureId ?? ""}|${grain?.textureId ?? ""}|${grain?.scale ?? 1}|${grain?.depth ?? 0}`
    if (key === appliedTextures) return
    appliedTextures = key
    renderer.setTip(
      brush.shape.tipTextureId
        ? (textures.get(brush.shape.tipTextureId) ?? null)
        : null
    )
    renderer.setGrain(
      grain ? (textures.get(grain.textureId) ?? null) : null,
      grain?.scale ?? 1,
      grain?.depth ?? 0
    )
  }

  function flushStamps() {
    if (stampCount === 0) return
    renderer?.stamp(stamps, stampCount)
    stampCount = 0
  }

  /**
   * One frame of drawing: drain everything the pen reported, stabilize it,
   * resample it by arc length, stamp, present. React is never told.
   */
  /** Hoisted so draining allocates no closure on any frame of a stroke. */
  function consumeSample(
    x: number,
    y: number,
    pressure: number,
    tiltX: number,
    tiltY: number,
    time: number
  ) {
    rawX = x
    rawY = y
    rawPressure = pressure
    rawTiltX = tiltX
    rawTiltY = tiltY
    rawTime = time
    if (frameObserver && frameOldestSample === null)
      frameOldestSample = strokeOrigin + time
    if (opening) {
      opening = false
      stabilizer.begin(x, y)
      resampler.begin(x, y, pressure, tiltX, tiltY, time, emitStamp)
      return
    }
    // Only position is stabilized: what the pen reported belongs to the sample
    // it was reported with, wherever the pulled string put the mark.
    const point = stabilizer.filter(x, y)
    resampler.extend(point.x, point.y, pressure, tiltX, tiltY, time, emitStamp)
  }

  function drawFrame(timestamp: number) {
    frame = undefined
    const cpuStart = frameObserver ? performance.now() : 0
    frameStamps = 0
    frameOldestSample = null
    samples.drain(consumeSample)
    // A stroke that ended before its opening sample was drained drew nothing.
    if (!stroking && !opening) {
      // The string is released on pen-up, so the mark reaches where the pen
      // lifted instead of stopping a pull radius short of it.
      resampler.extend(
        rawX,
        rawY,
        rawPressure,
        rawTiltX,
        rawTiltY,
        rawTime,
        emitStamp
      )
      resampler.end(emitStamp)
      flushStamps()
      // The whole mark is in the buffer now, so it goes into the layer once,
      // at the stroke's opacity (D27).
      renderer?.endStroke()
    }
    flushStamps()
    try {
      if (snapshot.status === "ready") render()
    } catch (error) {
      fail(error)
      return
    }
    if (frameObserver) reportFrame(timestamp, cpuStart)
    if (stroking) frame = requestAnimationFrame(drawFrame)
  }

  /**
   * Closes one frame's timing once the GPU says the frame is done. Read after
   * the fence rather than after submission, because submission only means the
   * work was handed over — the pixel the pen is waiting for is not on screen
   * until the queue has drained.
   */
  function reportFrame(timestamp: number, cpuStart: number) {
    const observer = frameObserver
    const queue = device?.queue
    if (!observer || !queue) return
    const cpuMs = performance.now() - cpuStart
    const stamps = frameStamps
    const oldest = frameOldestSample
    void queue.onSubmittedWorkDone().then(() => {
      if (frameObserver !== observer) return
      observer({
        start: timestamp,
        cpuMs,
        stamps,
        latencyMs: oldest === null ? null : performance.now() - oldest,
      })
    })
  }

  function scheduleFrame() {
    if (frame === undefined) frame = requestAnimationFrame(drawFrame)
  }

  function beginStroke(
    x: number,
    y: number,
    pressure: number,
    tiltX: number,
    tiltY: number,
    time: number,
    origin: number
  ) {
    if (snapshot.status !== "ready") return
    strokeOrigin = origin
    // Stroke opacity is applied once, at composite, so it is decided once,
    // here — from the pen state the stroke opened with. Nothing derived from
    // movement is known yet, so a mapping onto `opacity` reads what the pen
    // reported and not how it was moved; per-dab response is what `flow` is
    // for. Opening the tracker here is also what makes the first dab's own
    // context an advance rather than a restart.
    evaluateDynamics(
      brush.dynamics,
      dynamics.begin(x, y, pressure, tiltX, tiltY, time, ++strokeSeed),
      strokeParams
    )
    // Dabs land in the stroke buffer, not the layer, until the pen lifts.
    renderer?.beginStroke({
      accumulation: brush.rendering.accumulation,
      opacity: brush.rendering.opacity * strokeParams.opacity,
    })
    stroking = true
    opening = true
    samples.push(x, y, pressure, tiltX, tiltY, time)
    scheduleFrame()
  }

  function endStroke() {
    if (!stroking) return
    // The tail is flushed by the next frame, so the stroke reaches the point
    // the pen actually lifted from rather than stopping a sample short.
    stroking = false
    scheduleFrame()
  }

  function render(): GPUTexture {
    if (!device || !context || !renderer)
      throw new Error("The graphics device is not ready.")
    const texture = context.getCurrentTexture()
    renderer.render(texture.createView())
    return texture
  }

  /**
   * Wide gamut needs a display that can show it and a swap chain that can
   * present it. Configuring is the only honest test of the second, so an
   * unsupported colour space falls back rather than failing to start.
   */
  function configureOutput(
    target: GPUCanvasContext,
    acquired: GPUDevice
  ): OutputColorSpace {
    const configuration = {
      device: acquired,
      format,
      alphaMode: "opaque",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    } as const
    const displaySupportsP3 =
      globalThis.matchMedia?.("(color-gamut: p3)").matches ?? false
    const chosen = chooseOutputColorSpace({
      displaySupportsP3,
      gpuSupportsP3: displaySupportsP3 && acceptsP3(target, configuration),
    })
    target.configure({ ...configuration, colorSpace: chosen })
    return chosen
  }

  /** Whether this swap chain will take a P3 configuration at all. */
  function acceptsP3(
    target: GPUCanvasContext,
    configuration: GPUCanvasConfiguration
  ): boolean {
    try {
      target.configure({ ...configuration, colorSpace: "display-p3" })
      return true
    } catch {
      return false
    }
  }

  async function initialize() {
    publish({ status: "initializing", error: null })
    try {
      const gpu = navigator.gpu
      if (!gpu) {
        publish({ status: "unavailable" })
        return
      }
      const adapter = await gpu.requestAdapter()
      if (disposed) return
      if (!adapter) {
        publish({ status: "unavailable" })
        return
      }
      const acquired = await adapter.requestDevice()
      if (disposed) {
        acquired.destroy()
        return
      }
      device = acquired
      void acquired.lost.then((info) => {
        if (!disposed && device === acquired)
          fail(
            new Error(`Graphics device lost: ${info.message || info.reason}`)
          )
      })
      acquired.addEventListener("uncapturederror", (event) => {
        if (device === acquired) fail(event.error)
      })
      context = canvas.getContext("webgpu") as GPUCanvasContext | null
      if (!context) throw new Error("Could not create a WebGPU canvas context.")
      format = gpu.getPreferredCanvasFormat()
      acquired.pushErrorScope("validation")
      const colorSpace = configureOutput(context, acquired)
      renderer = createRenderer(acquired, {
        format,
        outputColorSpace: colorSpace,
        background: BACKGROUND,
        ink: BRUSH_COLOR,
        feather: BRUSH_FEATHER,
      })
      // A new renderer holds no textures, whatever the brush was told before.
      appliedTextures = undefined
      applyBrushTextures()
      publish({ outputColorSpace: colorSpace })
      resize()
      render()
      const error = await acquired.popErrorScope()
      if (disposed || device !== acquired) return
      if (error) throw new Error(error.message)
      // The host may have resized the canvas while validation was pending.
      render()
      publish({ status: "ready" })
      // Input is attached only once there is something to draw into.
      if (!detachSampler && canvas instanceof HTMLCanvasElement)
        detachSampler = attachPointerSampler(canvas, samples, {
          begin: beginStroke,
          end: endStroke,
        })
    } catch (error) {
      fail(error)
    }
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    async dispatch(command) {
      if (disposed) return
      switch (command.type) {
        case "initialize":
          if (snapshot.status === "ready") return
          if (!initialization)
            initialization = initialize().finally(() => {
              initialization = undefined
            })
          await initialization
          break
        case "resize":
          if (
            ![command.width, command.height, command.devicePixelRatio].every(
              Number.isFinite
            ) ||
            command.width < 0 ||
            command.height < 0 ||
            command.devicePixelRatio <= 0
          ) {
            throw new Error(
              "Viewport dimensions must be non-negative and density must be positive and finite."
            )
          }
          viewport = command
          try {
            resize()
            if (snapshot.status === "ready") render()
          } catch (error) {
            fail(error)
          }
          break
        case "setBrush": {
          for (const value of [command.opacity, command.flow])
            if (
              value !== undefined &&
              (!Number.isFinite(value) || value < 0 || value > 1)
            )
              throw new Error(
                "Brush opacity and flow must be finite values in [0, 1]."
              )
          for (const value of [command.radius, command.spacing])
            if (value !== undefined && (!Number.isFinite(value) || value <= 0))
              throw new Error("Brush radius and spacing must be positive.")
          if (
            command.roundness !== undefined &&
            (!Number.isFinite(command.roundness) ||
              command.roundness <= 0 ||
              command.roundness > 1)
          )
            throw new Error("Brush roundness must be in (0, 1].")
          if (command.angle !== undefined && !Number.isFinite(command.angle))
            throw new Error("Brush angle must be finite.")
          if (command.dynamics) validateDynamics(command.dynamics)
          // Textures are named, not carried, so a name that resolves to
          // nothing is caught here rather than silently drawing untextured.
          if (command.tipTextureId && !textures.get(command.tipTextureId))
            throw new Error(
              `No texture is registered as ${command.tipTextureId}.`
            )
          if (command.grain) {
            validateGrain(command.grain)
            if (!textures.get(command.grain.textureId))
              throw new Error(
                `No texture is registered as ${command.grain.textureId}.`
              )
          }
          const grain =
            command.grain === undefined
              ? brush.grain
              : (command.grain ?? undefined)
          const next: Brush = {
            ...brush,
            shape: {
              ...brush.shape,
              radius: command.radius ?? brush.shape.radius,
              spacing: command.spacing ?? brush.shape.spacing,
              roundness: command.roundness ?? brush.shape.roundness,
              angle: command.angle ?? brush.shape.angle,
              tipTextureId:
                command.tipTextureId === undefined
                  ? brush.shape.tipTextureId
                  : (command.tipTextureId ?? undefined),
            },
            rendering: {
              accumulation:
                command.accumulation ?? brush.rendering.accumulation,
              opacity: command.opacity ?? brush.rendering.opacity,
              flow: command.flow ?? brush.rendering.flow,
            },
            // Cloned on the way in: the engine owns its brush, and a caller
            // mutating the list it passed must not change a stroke in flight.
            dynamics: command.dynamics
              ? structuredClone(command.dynamics)
              : brush.dynamics,
          }
          // Absent rather than present-and-null, so a brush stays exactly the
          // JSON it round-trips as (D23).
          if (grain) next.grain = { ...grain }
          else delete next.grain
          // Spacing is fixed for the life of a resampler, so a brush that
          // changes it needs a new one. Never mid-stroke: the pen is up.
          if (brushSpacing(next) !== brushSpacing(brush))
            resampler = createStrokeResampler(brushSpacing(next))
          brush = next
          applyBrushTextures()
          publish({ brush: Object.freeze(cloneBrush(next)) })
          break
        }
        case "setStabilization": {
          if (!Number.isFinite(command.strength))
            throw new Error("Stabilization strength must be finite.")
          stabilizer.setStrength(command.strength)
          publish({ stabilization: stabilizer.strength() })
          break
        }
      }
    },
    observeFrames(observer) {
      frameObserver = observer
    },
    async readPixels() {
      if (snapshot.status !== "ready" || !device)
        throw new Error("The graphics device is not ready.")
      const { width, height } = snapshot
      const acquired = device
      const bytesPerRow = Math.ceil((width * 4) / 256) * 256
      const buffer = acquired.createBuffer({
        size: bytesPerRow * height,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      })
      try {
        // Acquire, render and copy in one task: the swap-chain texture expires at presentation.
        const texture = render()
        const encoder = acquired.createCommandEncoder()
        encoder.copyTextureToBuffer(
          { texture },
          { buffer, bytesPerRow },
          { width, height }
        )
        acquired.queue.submit([encoder.finish()])
        await buffer.mapAsync(GPUMapMode.READ)
        const mapped = new Uint8Array(buffer.getMappedRange())
        const data = new Uint8Array(width * height * 4)
        for (let y = 0; y < height; y++)
          data.set(
            mapped.subarray(y * bytesPerRow, y * bytesPerRow + width * 4),
            y * width * 4
          )
        if (format === "bgra8unorm") {
          for (let i = 0; i < data.length; i += 4)
            [data[i], data[i + 2]] = [data[i + 2], data[i]]
        }
        return { width, height, data, colorSpace: snapshot.outputColorSpace }
      } finally {
        buffer.destroy()
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      detachSampler?.()
      detachSampler = undefined
      // A disposed engine has no frames to report, and holding the observer
      // would keep whatever it closes over alive with it.
      frameObserver = null
      release()
      publish({ status: "disposed" })
      listeners.clear()
    },
  }
}
