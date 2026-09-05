export type EngineCommand =
  | { type: "initialize" }
  | { type: "resize"; width: number; height: number; devicePixelRatio: number }

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
  error: string | null
}>

export type RenderedPixels = {
  width: number
  height: number
  /** Display-encoded RGBA8, tightly packed, top row first. */
  data: Uint8Array
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
    error: null,
  })
  const listeners = new Set<() => void>()
  let device: GPUDevice | undefined
  let context: GPUCanvasContext | null = null
  let format: GPUTextureFormat = "bgra8unorm"
  let initialization: Promise<void> | undefined
  let viewport = { width: 1, height: 1, devicePixelRatio: 1 }
  let disposed = false

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
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight
    publish({ width: pixelWidth, height: pixelHeight })
  }

  function render(): GPUTexture {
    if (!device || !context)
      throw new Error("The graphics device is not ready.")
    const texture = context.getCurrentTexture()
    const encoder = device.createCommandEncoder()
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: texture.createView(),
          clearValue: { r: 24 / 255, g: 24 / 255, b: 27 / 255, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    })
    pass.end()
    device.queue.submit([encoder.finish()])
    return texture
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
      context.configure({
        device: acquired,
        format,
        alphaMode: "opaque",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      })
      resize()
      render()
      const error = await acquired.popErrorScope()
      if (disposed || device !== acquired) return
      if (error) throw new Error(error.message)
      // The host may have resized the canvas while validation was pending.
      render()
      publish({ status: "ready" })
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
        return { width, height, data }
      } finally {
        buffer.destroy()
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      release()
      publish({ status: "disposed" })
      listeners.clear()
    },
  }
}
