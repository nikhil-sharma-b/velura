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

const LAYER_FORMAT: GPUTextureFormat = "rgba16float"
const BYTES_PER_TEXEL = TILE_CHANNELS * 2
/** mat3x3 occupies three 16-byte columns, then one vec4 of background. */
const UNIFORM_BYTES = 64

export interface Renderer {
  /** (Re)allocates the linear-light target; the next upload rewrites it whole. */
  resize(width: number, height: number): void
  /** Uploads the tiles the layer marked dirty, and clears that mark. */
  upload(layer: TiledLayer): void
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
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      })
      bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: uniform } },
          { binding: 1, resource: target.createView() },
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
      bindGroup = undefined
      uniform.destroy()
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
