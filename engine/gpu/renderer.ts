import type { Accumulation } from "../brush/round-brush"
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
import { strokeCompositeShader } from "../shaders/stroke-composite"
import { STAMP, STAMP_STRIDE } from "./stamp-instance"
import { createStampLog } from "./stamp-log"

const LAYER_FORMAT: GPUTextureFormat = "rgba16float"
const BYTES_PER_TEXEL = TILE_CHANNELS * 2
/**
 * mat3x3 occupies three 16-byte columns, then one vec4 of background and the
 * stroke opacity, padded to the 16-byte alignment a uniform buffer requires.
 */
const UNIFORM_BYTES = 80
/** Where the stroke opacity sits in that buffer: after matrix and background. */
const STROKE_OPACITY_OFFSET = 64
/** vec2 viewport, feather and padding, then one vec4 of ink. */
const STAMP_UNIFORM_BYTES = 32
/** One f32 of stroke opacity, padded to the minimum uniform binding size. */
const COMPOSITE_UNIFORM_BYTES = 16
/**
 * Dabs of one stroke the buffer can replay. A long stroke at a quarter-tip
 * spacing is a few thousand; past this the stroke still draws, but discarding
 * its tail is refused rather than allocating on a frame of drawing (D30).
 */
export const MAX_STAMPS_PER_STROKE = 1 << 16
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
   * Opens a stroke: empties the stroke buffer and fixes how this stroke's dabs
   * combine and what the finished mark's opacity will be.
   */
  beginStroke(stroke: { accumulation: Accumulation; opacity: number }): void
  /**
   * Draws `count` dabs from `instances` into the stroke buffer, packed as
   * centre x, centre y, radius and opacity. The caller owns the array, reuses
   * it across frames, and draws before it exceeds `MAX_STAMPS_PER_DRAW`.
   */
  stamp(instances: Float32Array, count: number): void
  /**
   * Removes the last `count` dabs by replaying the stroke without them, which
   * is how mispredicted input will be taken back (D26). Returns false, having
   * changed nothing, if the stroke has outrun the log it replays from.
   */
  discardStamps(count: number): boolean
  /** Composites the stroke buffer into the layer, once, at stroke opacity. */
  endStroke(): void
  render(view: GPUTextureView): void
  destroy(): void
}

/**
 * Owns the linear-light layer target, the stroke buffer that dabs land in
 * before the layer sees them (D27), and the single display-transform pass.
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
  /**
   * One pipeline per accumulation mode: the difference between a marker and a
   * pencil is entirely the blend state, so the shader is shared.
   *
   * `coverage` takes the per-channel maximum. The ink colour is constant
   * across a stroke, so a premultiplied dab is `colour x alpha` and the
   * channel-wise maximum is exactly the maximum coverage — a crossing does not
   * darken. `buildup` is ordinary premultiplied "over", so each dab adds.
   */
  const stampBlends: Record<Accumulation, GPUBlendState> = {
    coverage: {
      color: { operation: "max", srcFactor: "one", dstFactor: "one" },
      alpha: { operation: "max", srcFactor: "one", dstFactor: "one" },
    },
    buildup: {
      color: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
      alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
    },
  }
  // Explicit, because two pipelines share one bind group: an automatic layout
  // belongs to the pipeline that produced it and the other would reject it.
  const stampBindGroupLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: "uniform" },
      },
    ],
  })
  const stampPipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [stampBindGroupLayout],
  })
  const stampPipelineFor = (accumulation: Accumulation) =>
    device.createRenderPipeline({
      layout: stampPipelineLayout,
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
              {
                shaderLocation: 1,
                offset: STAMP.RADIUS * 4,
                format: "float32",
              },
              {
                shaderLocation: 2,
                offset: STAMP.OPACITY * 4,
                format: "float32",
              },
            ],
          },
        ],
      },
      fragment: {
        module: stampModule,
        entryPoint: "fragmentMain",
        targets: [{ format: LAYER_FORMAT, blend: stampBlends[accumulation] }],
      },
      primitive: { topology: "triangle-list" },
    })

  const stampPipelines: Record<Accumulation, GPURenderPipeline> = {
    coverage: stampPipelineFor("coverage"),
    buildup: stampPipelineFor("buildup"),
  }

  const compositeModule = device.createShaderModule({
    code: strokeCompositeShader,
  })
  const compositePipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module: compositeModule, entryPoint: "vertexMain" },
    fragment: {
      module: compositeModule,
      entryPoint: "fragmentMain",
      targets: [
        {
          format: LAYER_FORMAT,
          // The finished stroke goes over the layer, premultiplied.
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
  const compositeUniform = device.createBuffer({
    size: COMPOSITE_UNIFORM_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  let stampBindGroup: GPUBindGroup | undefined
  let compositeBindGroup: GPUBindGroup | undefined
  // Held rather than recreated: the stamp pass runs every frame of a stroke.
  let targetView: GPUTextureView | undefined
  let strokeView: GPUTextureView | undefined

  let target: GPUTexture | undefined
  let stroke: GPUTexture | undefined
  let bindGroup: GPUBindGroup | undefined
  // A fresh target holds nothing, so the first upload after it cannot be
  // narrowed to the dirty region.
  let targetIsEmpty = true

  // The stroke in flight. The log lets the buffer be rewound; the bounds keep
  // clearing and compositing to the region the stroke actually covers.
  const log = createStampLog(MAX_STAMPS_PER_STROKE)
  let accumulation: Accumulation = "coverage"
  // Mutated rather than replaced: an empty region is one that has not been
  // grown yet, so the bounds start inverted.
  const painted = { left: 0, top: 0, right: 0, bottom: 0 }

  function resetPainted() {
    painted.left = Infinity
    painted.top = Infinity
    painted.right = -Infinity
    painted.bottom = -Infinity
  }
  resetPainted()

  /** Grows the painted region to hold `count` dabs, rims included. */
  function growPainted(instances: Float32Array, count: number) {
    for (let i = 0; i < count; i++) {
      const offset = i * STAMP_STRIDE
      const x = instances[offset + STAMP.CENTER_X]
      const y = instances[offset + STAMP.CENTER_Y]
      const radius = instances[offset + STAMP.RADIUS]
      painted.left = Math.min(painted.left, x - radius)
      painted.top = Math.min(painted.top, y - radius)
      painted.right = Math.max(painted.right, x + radius)
      painted.bottom = Math.max(painted.bottom, y + radius)
    }
  }

  /** Both passes that fade the stroke read its opacity from a uniform. */
  function writeStrokeOpacity(opacity: number) {
    device.queue.writeBuffer(compositeUniform, 0, new Float32Array([opacity]))
    // The present pass shows the stroke in flight at the same opacity, so the
    // mark on screen is the one that will be composited.
    device.queue.writeBuffer(
      uniform,
      STROKE_OPACITY_OFFSET,
      new Float32Array([opacity])
    )
  }

  /** The painted region in whole pixels, clipped to the buffer. Null if empty. */
  function paintedScissor() {
    if (!stroke || painted.right <= painted.left) return null
    const x = Math.max(0, Math.floor(painted.left))
    const y = Math.max(0, Math.floor(painted.top))
    const width = Math.min(stroke.width, Math.ceil(painted.right)) - x
    const height = Math.min(stroke.height, Math.ceil(painted.bottom)) - y
    if (width <= 0 || height <= 0) return null
    return { x, y, width, height }
  }

  /**
   * Empties the stroke buffer. A clear is a load operation, which a scissor
   * rectangle does not narrow, so this is always the whole buffer — it runs
   * when a stroke starts, ends or rewinds, never on a frame of drawing.
   */
  function clearStroke() {
    if (!strokeView) throw new Error("The render target has not been sized.")
    const encoder = device.createCommandEncoder()
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: strokeView,
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    })
    pass.end()
    device.queue.submit([encoder.finish()])
  }

  /** Draws `count` dabs of the current stroke into the buffer. */
  function drawStamps(instances: Float32Array, offset: number, count: number) {
    if (!strokeView || !stampBindGroup)
      throw new Error("The render target has not been sized.")
    device.queue.writeBuffer(
      stampInstances,
      0,
      instances,
      offset * STAMP_STRIDE,
      count * STAMP_STRIDE
    )
    const encoder = device.createCommandEncoder()
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        // The buffer holds the stroke so far: dabs blend onto it.
        { view: strokeView, loadOp: "load", storeOp: "store" },
      ],
    })
    pass.setPipeline(stampPipelines[accumulation])
    pass.setBindGroup(0, stampBindGroup)
    pass.setVertexBuffer(0, stampInstances)
    pass.draw(6, count)
    pass.end()
    device.queue.submit([encoder.finish()])
  }

  return {
    resize(width, height) {
      target?.destroy()
      stroke?.destroy()
      targetIsEmpty = true
      log.reset()
      resetPainted()
      const usage =
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT
      target = device.createTexture({
        size: { width, height },
        format: LAYER_FORMAT,
        usage,
      })
      // The stroke buffer matches the layer texel for texel, so a dab lands at
      // the same pixel in both and the composite is a straight copy. §6.2 wants
      // it bounded to the stroke's region; it narrows to a tiled surface with
      // the per-layer atlases (D-6.1), which is what bounds the layer too.
      stroke = device.createTexture({
        size: { width, height },
        format: LAYER_FORMAT,
        usage,
      })
      device.queue.writeBuffer(
        stampUniform,
        0,
        new Float32Array([width, height, options.feather, 0, ...options.ink])
      )
      targetView = target.createView()
      strokeView = stroke.createView()
      stampBindGroup = device.createBindGroup({
        layout: stampBindGroupLayout,
        entries: [{ binding: 0, resource: { buffer: stampUniform } }],
      })
      compositeBindGroup = device.createBindGroup({
        layout: compositePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: compositeUniform } },
          { binding: 1, resource: strokeView },
        ],
      })
      bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: uniform } },
          { binding: 1, resource: targetView },
          { binding: 2, resource: strokeView },
        ],
      })
      // A fresh texture is already transparent, but the previous stroke's
      // opacity is not; both passes read it from a uniform.
      writeStrokeOpacity(1)
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
    beginStroke(options) {
      if (!strokeView) throw new Error("The render target has not been sized.")
      if (
        !Number.isFinite(options.opacity) ||
        options.opacity < 0 ||
        options.opacity > 1
      )
        throw new Error("Stroke opacity must be a finite value in [0, 1].")
      clearStroke()
      resetPainted()
      log.reset()
      accumulation = options.accumulation
      writeStrokeOpacity(options.opacity)
    },
    stamp(instances, count) {
      if (count <= 0) return
      if (count > MAX_STAMPS_PER_DRAW)
        throw new Error("Too many dabs for one draw.")
      log.append(instances, count)
      growPainted(instances, count)
      drawStamps(instances, 0, count)
    },
    discardStamps(count) {
      // Coverage blending forgets what a dab covered, so the tail comes off by
      // replaying the stroke without it — which needs the whole stroke logged.
      if (!log.replayable()) return false
      if (count <= 0) return true
      log.discard(count)
      clearStroke()
      // The surviving dabs cover no more than the discarded ones did, so the
      // bounds stay valid; they are conservative, never wrong.
      log.replay(MAX_STAMPS_PER_DRAW, drawStamps)
      return true
    },
    endStroke() {
      if (!targetView || !compositeBindGroup)
        throw new Error("The render target has not been sized.")
      const region = paintedScissor()
      log.reset()
      resetPainted()
      if (!region) return
      const encoder = device.createCommandEncoder()
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          { view: targetView, loadOp: "load", storeOp: "store" },
        ],
      })
      pass.setPipeline(compositePipeline)
      pass.setBindGroup(0, compositeBindGroup)
      pass.setScissorRect(region.x, region.y, region.width, region.height)
      pass.draw(3)
      pass.end()
      device.queue.submit([encoder.finish()])
      // The mark now lives in the layer target; the buffer must not show it a
      // second time through the present pass.
      clearStroke()
      // Nothing between strokes should depend on the last stroke's opacity.
      writeStrokeOpacity(1)
      // Painted pixels live only in the target; the tiled layer learns about
      // them when tile readback lands with undo (ticket 12).
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
      stroke?.destroy()
      target = undefined
      stroke = undefined
      targetView = undefined
      strokeView = undefined
      bindGroup = undefined
      stampBindGroup = undefined
      compositeBindGroup = undefined
      uniform.destroy()
      stampUniform.destroy()
      stampInstances.destroy()
      compositeUniform.destroy()
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
  // Stroke opacity, rewritten per stroke; opaque until one begins.
  data[STROKE_OPACITY_OFFSET / 4] = 1
  return data
}
