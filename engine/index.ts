import {
  chooseOutputColorSpace,
  type OutputColorSpace,
} from "./color/display-transform"
import {
  BRUSH_COLOR,
  BRUSH_FEATHER,
  BRUSH_RADIUS,
  BRUSH_SPACING,
} from "./brush/round-brush"
import { BACKGROUND, createScene } from "./doc/scene"
import type { TiledLayer } from "./doc/tiled-layer"
import { createStrokeResampler } from "./geom/path"
import { createStabilizer } from "./geom/stabilizer"
import { attachPointerSampler } from "./input/pointer-sampler"
import { createSampleBuffer } from "./input/sample-buffer"
import {
  createRenderer,
  MAX_STAMPS_PER_DRAW,
  type Renderer,
  STAMP_STRIDE,
} from "./gpu/renderer"

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
  error: string | null
}>

export type RenderedPixels = {
  width: number
  height: number
  /** Display-encoded RGBA8, tightly packed, top row first. */
  data: Uint8Array
  /** The colour space `data` is encoded in. */
  colorSpace: OutputColorSpace
}

export interface Engine {
  dispatch(command: EngineCommand): Promise<void>
  getSnapshot(): EngineSnapshot
  subscribe(listener: () => void): () => void
  /** Explicit asynchronous readback for tests and future export; never per frame. */
  readPixels(): Promise<RenderedPixels>
  dispose(): void
}

/** Canvas attachment is a lifecycle operation; commands contain only values. */
export function createEngine(
  canvas: HTMLCanvasElement | OffscreenCanvas
): Engine {
  let snapshot: EngineSnapshot = Object.freeze({
    status: "idle",
    width: 1,
    height: 1,
    outputColorSpace: "srgb",
    stabilization: DEFAULT_STABILIZATION,
    error: null,
  })
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
  const resampler = createStrokeResampler(BRUSH_SPACING)
  const stamps = new Float32Array(MAX_STAMPS_PER_DRAW * STAMP_STRIDE)
  let stampCount = 0
  let stroking = false
  // Where the pen actually was, before stabilization pulled the path behind it.
  let rawX = 0
  let rawY = 0
  let frame: number | undefined
  let detachSampler: (() => void) | undefined
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

  /** Collects one dab, drawing early if the instance buffer would overflow. */
  function emitStamp(x: number, y: number) {
    if (stampCount === MAX_STAMPS_PER_DRAW) flushStamps()
    const offset = stampCount * STAMP_STRIDE
    stamps[offset] = x
    stamps[offset + 1] = y
    stamps[offset + 2] = BRUSH_RADIUS
    // Fixed opacity for now; pressure and the dynamics graph land in later
    // tickets and modulate exactly these two slots.
    stamps[offset + 3] = 1
    stampCount++
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
  function drawFrame() {
    frame = undefined
    samples.drain((x, y) => {
      rawX = x
      rawY = y
      const point = stabilizer.filter(x, y)
      resampler.extend(point.x, point.y, emitStamp)
    })
    if (!stroking) {
      // The string is released on pen-up, so the mark reaches where the pen
      // lifted instead of stopping a pull radius short of it.
      resampler.extend(rawX, rawY, emitStamp)
      resampler.end(emitStamp)
    }
    flushStamps()
    try {
      if (snapshot.status === "ready") render()
    } catch (error) {
      fail(error)
      return
    }
    if (stroking) frame = requestAnimationFrame(drawFrame)
  }

  function scheduleFrame() {
    if (frame === undefined) frame = requestAnimationFrame(drawFrame)
  }

  function beginStroke(x: number, y: number) {
    if (snapshot.status !== "ready") return
    stroking = true
    rawX = x
    rawY = y
    stabilizer.begin(x, y)
    resampler.begin(x, y, emitStamp)
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
        case "setStabilization": {
          if (!Number.isFinite(command.strength))
            throw new Error("Stabilization strength must be finite.")
          stabilizer.setStrength(command.strength)
          publish({ stabilization: stabilizer.strength() })
          break
        }
      }
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
      release()
      publish({ status: "disposed" })
      listeners.clear()
    },
  }
}
