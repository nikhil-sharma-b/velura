import {
  type ColorMatrix,
  type OutputColorSpace,
  workingToOutputMatrix,
} from "../color/display-transform"
import {
  intersectRect,
  TILE_CHANNELS,
  TILE_SIZE,
  tileBounds,
} from "../doc/tile-grid"
import type { TiledLayer } from "../doc/tiled-layer"
import { displayTransformShader } from "../shaders/display-transform"
import { stampShader } from "../shaders/stamp"

const LAYER_FORMAT: GPUTextureFormat = "rgba16float"
const BYTES_PER_TEXEL = TILE_CHANNELS * 2
/** mat3x3 occupies three 16-byte columns, then one vec4 of background. */
const UNIFORM_BYTES = 64
/** vec2 viewport, feather and padding, then one vec4 of ink. */
const STAMP_UNIFORM_BYTES = 32
/**
 * Layout of one dab instance. Named because three places agree on it: the
 * vertex attributes below, the engine that fills the array, and the shader's
 * locations. Pressure-driven size and opacity will move exactly these slots.
 */
export const STAMP = {
  CENTER_X: 0,
  CENTER_Y: 1,
  RADIUS: 2,
  OPACITY: 3,
} as const

/** Floats per dab instance. */
export const STAMP_STRIDE = 4
/**
 * Dabs drawn in one submission. A 120 Hz frame of the fastest plausible stroke
 * is a few hundred; the ceiling exists so the instance buffer can be allocated
 * once, and the caller draws early rather than overrunning it.
 */
export const MAX_STAMPS_PER_DRAW = 2048

export interface Renderer {
  /** (Re)allocates the linear-light target; the next upload rewrites it whole. */
  resize(width: number, height: number): void
  /** Uploads the tiles the layer marked dirty, and clears that mark. */
  upload(layer: TiledLayer): void
  /**
   * Draws `count` dabs from `instances`, packed as centre x, centre y, radius
   * and opacity. The caller owns the array, reuses it across frames, and draws
   * before it exceeds `MAX_STAMPS_PER_DRAW`.
   */
  stamp(instances: Float32Array, count: number): void
  render(view: GPUTextureView): void
  destroy(): void
}

/**
 * Owns the linear-light render target and the single display-transform pass.
 * Tiles are uploaded into a canvas-sized `rgba16float` target; per-layer
 * atlases (D-6.1) replace that upload path without moving this seam.
 */
export function createRenderer(
  device: GPUDevice,
  options: {
    format: GPUTextureFormat
    outputColorSpace: OutputColorSpace
    /** Opaque canvas backdrop, working-space linear. */
    background: readonly [number, number, number]
    /** Premultiplied linear-light ink, and the dab rim falloff in pixels. */
    ink: readonly [number, number, number, number]
    feather: number
  }
): Renderer {
  const shader = device.createShaderModule({ code: displayTransformShader })
  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module: shader, entryPoint: "vertexMain" },
    fragment: {
      module: shader,
      entryPoint: "fragmentMain",
      targets: [{ format: options.format }],
    },
    primitive: { topology: "triangle-list" },
  })

  const uniform = device.createBuffer({
    size: UNIFORM_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(
    uniform,
    0,
    packUniform(
      workingToOutputMatrix(options.outputColorSpace),
      options.background
    )
  )

  const stampModule = device.createShaderModule({ code: stampShader })
  const stampPipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: stampModule,
      entryPoint: "vertexMain",
      buffers: [
        {
          arrayStride: STAMP_STRIDE * 4,
          stepMode: "instance",
          attributes: [
            {
              shaderLocation: 0,
              offset: STAMP.CENTER_X * 4,
              format: "float32x2",
            },
            { shaderLocation: 1, offset: STAMP.RADIUS * 4, format: "float32" },
            { shaderLocation: 2, offset: STAMP.OPACITY * 4, format: "float32" },
          ],
        },
      ],
    },
    fragment: {
      module: stampModule,
      entryPoint: "fragmentMain",
      targets: [
        {
          format: LAYER_FORMAT,
          // Premultiplied "over": the shader already multiplied by coverage.
          blend: {
            color: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
            alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
          },
        },
      ],
    },
    primitive: { topology: "triangle-list" },
  })

  const stampUniform = device.createBuffer({
    size: STAMP_UNIFORM_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const stampInstances = device.createBuffer({
    size: MAX_STAMPS_PER_DRAW * STAMP_STRIDE * 4,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  })
  let stampBindGroup: GPUBindGroup | undefined
  // Held rather than recreated: the stamp pass runs every frame of a stroke.
  let targetView: GPUTextureView | undefined

  let target: GPUTexture | undefined
  let bindGroup: GPUBindGroup | undefined
  // A fresh target holds nothing, so the first upload after it cannot be
  // narrowed to the dirty region.
  let targetIsEmpty = true

  return {
    resize(width, height) {
      target?.destroy()
      targetIsEmpty = true
      target = device.createTexture({
        size: { width, height },
        format: LAYER_FORMAT,
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.RENDER_ATTACHMENT,
      })
      device.queue.writeBuffer(
        stampUniform,
        0,
        new Float32Array([width, height, options.feather, 0, ...options.ink])
      )
      targetView = target.createView()
      stampBindGroup = device.createBindGroup({
        layout: stampPipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: stampUniform } }],
      })
      bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: uniform } },
          { binding: 1, resource: targetView },
        ],
      })
    },
    upload(layer) {
      if (!target) throw new Error("The render target has not been sized.")
      const dirty = layer.dirtyBounds()
      if (!targetIsEmpty && !dirty) return
      const canvas = {
        x: 0,
        y: 0,
        width: target.width,
        height: target.height,
      }
      for (const tile of layer.tiles()) {
        const bounds = tileBounds(tile)
        // Edge tiles hang past the canvas; upload only the visible sub-rect.
        const visible = intersectRect(bounds, canvas)
        if (!visible) continue
        if (!targetIsEmpty && dirty && !intersectRect(bounds, dirty)) continue
        device.queue.writeTexture(
          { texture: target, origin: { x: visible.x, y: visible.y } },
          tile.texels,
          { bytesPerRow: TILE_SIZE * BYTES_PER_TEXEL, rowsPerImage: TILE_SIZE },
          { width: visible.width, height: visible.height }
        )
      }
      targetIsEmpty = false
      layer.clearDirty()
    },
    stamp(instances, count) {
      if (!targetView || !stampBindGroup)
        throw new Error("The render target has not been sized.")
      if (count <= 0) return
      if (count > MAX_STAMPS_PER_DRAW)
        throw new Error("Too many dabs for one draw.")
      device.queue.writeBuffer(
        stampInstances,
        0,
        instances,
        0,
        count * STAMP_STRIDE
      )
      const encoder = device.createCommandEncoder()
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: targetView,
            // The target holds the painting so far: dabs blend onto it.
            loadOp: "load",
            storeOp: "store",
          },
        ],
      })
      pass.setPipeline(stampPipeline)
      pass.setBindGroup(0, stampBindGroup)
      pass.setVertexBuffer(0, stampInstances)
      pass.draw(6, count)
      pass.end()
      device.queue.submit([encoder.finish()])
      // Painted pixels now live only in the target; the tiled layer learns
      // about them when the stroke buffer is composited back (ticket 04).
      targetIsEmpty = false
    },
    render(view) {
      if (!bindGroup) throw new Error("The render target has not been sized.")
      const encoder = device.createCommandEncoder()
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view,
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: "clear",
            storeOp: "store",
          },
        ],
      })
      pass.setPipeline(pipeline)
      pass.setBindGroup(0, bindGroup)
      pass.draw(3)
      pass.end()
      device.queue.submit([encoder.finish()])
    },
    destroy() {
      target?.destroy()
      target = undefined
      targetView = undefined
      bindGroup = undefined
      stampBindGroup = undefined
      uniform.destroy()
      stampUniform.destroy()
      stampInstances.destroy()
    },
  }
}

/** WGSL matrices are column-major with 16-byte column stride. */
function packUniform(
  rowMajor: ColorMatrix,
  background: readonly [number, number, number]
): Float32Array {
  const data = new Float32Array(UNIFORM_BYTES / 4)
  for (let column = 0; column < 3; column++)
    for (let row = 0; row < 3; row++)
      data[column * 4 + row] = rowMajor[row * 3 + column]
  data.set([...background, 1], 12)
  return data
}
