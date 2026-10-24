import { createTiledLayer } from "../../engine/doc/tiled-layer"
import { TILE_SIZE } from "../../engine/doc/tile-grid"
import { createRenderer } from "../../engine/gpu/renderer"
import { SMUDGE, SMUDGE_STRIDE } from "../../engine/gpu/smudge-dab"

export const SMEAR_WIDTH = 240
export const SMEAR_HEIGHT = 120

export type SmearOptions = {
  radius: number
  /** Falloff at the disc's rim, in pixels; zero is a hard edge. */
  feather?: number
  /** A tip texture for the dab's shape, in place of the disc. */
  tip?: boolean
  angle?: number
  roundness?: number
  /** A radius the dab grows to along the stroke, from `radius`. */
  growsTo?: number
  /**
   * Which pass draws the dabs: the compute pass a run of them shares, or the
   * render pass a dab too large for a run is given.
   */
  pass: "run" | "render"
  /**
   * A narrower limit on a run's region than the renderer's own, so that a
   * dab can outgrow it on a canvas this small.
   */
  runSize?: number
}

export type Smear = {
  /** The layer's half floats as bits, a row after another. */
  texels: number[]
  /** Passes of each kind the dabs were drawn in. */
  computePasses: number
  renderPasses: number
}

/**
 * Smudges a bar and a stripe along a path of four legs, straight through the
 * renderer, and answers the layer as it is stored: the bits of its
 * premultiplied linear half floats, a row after another.
 */
export async function smearProbe(options: SmearOptions): Promise<Smear> {
  const width = SMEAR_WIDTH
  const height = SMEAR_HEIGHT
  const adapter = await navigator.gpu.requestAdapter()
  const device = await adapter!.requestDevice()
  const errors: string[] = []
  device.addEventListener("uncapturederror", (event) =>
    errors.push(event.error.message)
  )
  const renderer = createRenderer(device, {
    format: "rgba8unorm",
    outputColorSpace: "srgb",
    background: [1, 1, 1],
    ink: [0.5, 0.5, 0.5, 1],
    feather: options.feather ?? 1,
    directRunSize: options.pass === "run" ? options.runSize : 0,
  })
  try {
    renderer.resize(width, height)
    if (options.tip) {
      // A soft diagonal, so that a turned dab is not the dab unturned.
      const size = 32
      const data = new Uint8Array(size * size)
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++)
          data[y * size + x] = Math.max(0, 255 - Math.abs(x - y) * 24)
      renderer.setTip({ width: size, height: size, data })
    }
    const layer = createTiledLayer({ width, height })
    layer.fillRect(
      { x: 40, y: 48, width: 60, height: 24 },
      [0.6, 0.02, 0.03, 1]
    )
    layer.fillRect(
      { x: 130, y: 20, width: 12, height: 80 },
      [0.02, 0.15, 0.3, 0.6]
    )
    renderer.uploadLayer("layer", layer)
    // Counted from here, so that only the dabs' own passes are.
    let computePasses = 0
    let renderPasses = 0
    const createCommandEncoder = device.createCommandEncoder.bind(device)
    device.createCommandEncoder = (descriptor) => {
      const encoder = createCommandEncoder(descriptor)
      const beginComputePass = encoder.beginComputePass.bind(encoder)
      const beginRenderPass = encoder.beginRenderPass.bind(encoder)
      encoder.beginComputePass = (pass) => {
        computePasses++
        return beginComputePass(pass)
      }
      encoder.beginRenderPass = (pass) => {
        renderPasses++
        return beginRenderPass(pass)
      }
      return encoder
    }
    if (!renderer.beginDirect("layer", null))
      throw new Error("The smudge did not begin.")
    const corners = [
      [50, 60],
      [170.3, 52.6],
      [150.7, 90.2],
      [80.4, 30.9],
      [60.2, 80.5],
    ]
    const spacing = Math.max(1, options.radius / 4)
    const legs = corners.length - 1
    const dabs: number[] = []
    for (let leg = 1; leg < corners.length; leg++) {
      const [fromX, fromY] = corners[leg - 1]
      const [toX, toY] = corners[leg]
      const steps = Math.ceil(Math.hypot(toX - fromX, toY - fromY) / spacing)
      for (let step = leg === 1 ? 0 : 1; step <= steps; step++) {
        const dab = new Array<number>(SMUDGE_STRIDE).fill(0)
        dab[SMUDGE.CENTER_X] = fromX + ((toX - fromX) * step) / steps
        dab[SMUDGE.CENTER_Y] = fromY + ((toY - fromY) * step) / steps
        const along = (leg - 1 + step / steps) / legs
        dab[SMUDGE.RADIUS] =
          options.radius +
          ((options.growsTo ?? options.radius) - options.radius) * along
        dab[SMUDGE.STRENGTH] = 0.8
        dab[SMUDGE.ANGLE] = options.angle ?? 0
        dab[SMUDGE.ROUNDNESS] = options.roundness ?? 1
        dabs.push(...dab)
      }
    }
    // A frame's worth to a call, as the engine hands them over.
    const perCall = 24 * SMUDGE_STRIDE
    for (let start = 0; start < dabs.length; start += perCall) {
      const call = new Float32Array(dabs.slice(start, start + perCall))
      renderer.drawDirect(call, call.length / SMUDGE_STRIDE)
    }
    renderer.endDirect(true)
    device.createCommandEncoder = createCommandEncoder
    const [tile] = await renderer.readTiles("layer", [{ x: 0, y: 0 }])
    if (errors.length) throw new Error(errors.join("\n"))
    const texels: number[] = []
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width * 4; x++)
        texels.push(tile[y * TILE_SIZE * 4 + x])
    return { texels, computePasses, renderPasses }
  } finally {
    renderer.destroy()
    device.destroy()
  }
}
