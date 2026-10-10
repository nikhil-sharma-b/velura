import type { Accumulation } from "../brush/round-brush"
import type { PixelRect } from "../doc/tile-grid"
import { clearRegionShader } from "../shaders/clear-region"
import { stampShader } from "../shaders/stamp"
import { STAMP, STAMP_STRIDE } from "./stamp-instance"
import { createStampLog } from "./stamp-log"
import type { StrokeRenderer } from "./stroke-renderer"
import { LAYER_FORMAT, type Surface } from "./surface"

/** Inverse coverage per stroke pixel (D27); the stamp and clear passes share it. */
const COVERAGE_DEPTH_FORMAT: GPUTextureFormat = "depth16unorm"

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

export type StrokeMode = "paint" | "erase"

/** What a buffered stroke is told as it opens. */
export type BufferedOpening = {
  /** How this stroke's dabs combine with each other (D27). */
  accumulation: Accumulation
  /** What the finished mark's opacity will be. */
  opacity: number
  mode: StrokeMode
}

/** What the buffered stroke reads of, and asks of, the renderer it draws for. */
export type BufferedStrokeContext = {
  /** The document's size in pixels. */
  size(): { width: number; height: number }
  /** The stroke buffer, once the renderer has been sized. */
  buffer(): Surface | undefined
  /** The brush as the stamp pass binds it: tip, grain, ink and selection. */
  binding(): GPUBindGroup | undefined
  /** The surface the stroke lands on when it ends. */
  target(): Surface | undefined
  /** Composites `region` of the buffer into the target, once (D27). */
  land(
    buffer: Surface,
    target: Surface,
    opacity: number,
    region: PixelRect,
    mode: StrokeMode
  ): void
  /** Tells what shows the stroke in flight the opacity it will land at. */
  showOpacity(opacity: number): void
  /** Tells what shows the stroke in flight whether it paints or erases. */
  showMode(mode: StrokeMode): void
}

/**
 * The buffered stroke, and what the renderer has to ask and tell it about
 * the things it holds on to between dabs.
 */
export interface BufferedStroke extends StrokeRenderer<BufferedOpening> {
  /** What a bind group handed over by `binding` has to be laid out as. */
  readonly bindingLayout: GPUBindGroupLayout
  /**
   * Removes the last `count` dabs by replaying the stroke without them, which
   * is how mispredicted input will be taken back (D26). Returns false, having
   * changed nothing, if the stroke has outrun the log it replays from.
   */
  discard(count: number): boolean
  /** The opacity the stroke in flight will land at; one between strokes. */
  opacity(): number
  mode(): StrokeMode
  /** The document was resized and the buffer replaced: nothing is in flight. */
  resize(): void
  destroy(): void
}

/**
 * The stroke every brush draws (D27): dabs go into the stroke buffer, which
 * the compositor shows over the layer while the pen is down, and the buffer
 * is composited into the layer once, at the stroke's opacity, when it lifts.
 */
export function createBufferedStroke(
  device: GPUDevice,
  context: BufferedStrokeContext
): BufferedStroke {
  const stampModule = device.createShaderModule({ code: stampShader })
  /**
   * One pipeline per accumulation mode: the difference between a marker and a
   * pencil is pipeline state, so the shader is shared.
   *
   * Coverage uses inverse alpha as depth: the greatest coverage wins with
   * its complete colour, and later dabs win ties. Buildup uses ordinary
   * premultiplied over. Both draw every instance in one pass.
   */
  const buildupBlend: GPUBlendState = {
    color: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
    alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
  }
  // Explicit, because two pipelines share one bind group: an automatic layout
  // belongs to the pipeline that produced it and the other would reject it.
  const bindingLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: "uniform" },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.FRAGMENT,
        sampler: { type: "filtering" },
      },
      {
        binding: 2,
        visibility: GPUShaderStage.FRAGMENT,
        sampler: { type: "filtering" },
      },
      {
        binding: 3,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: "float", viewDimension: "2d-array" },
      },
      {
        binding: 4,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: "float" },
      },
      {
        binding: 5,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: "float" },
      },
    ],
  })
  const stampPipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [bindingLayout],
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
                shaderLocation: 7,
                offset: STAMP.TIP_FRAME * 4,
                format: "float32",
              },
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
              {
                shaderLocation: 3,
                offset: STAMP.ANGLE * 4,
                format: "float32",
              },
              {
                shaderLocation: 4,
                offset: STAMP.ROUNDNESS * 4,
                format: "float32",
              },
              {
                shaderLocation: 6,
                offset: STAMP.HUE * 4,
                format: "float32x3",
              },
              {
                shaderLocation: 5,
                offset: STAMP.GRAIN_DEPTH * 4,
                format: "float32",
              },
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
            ...(accumulation === "buildup" ? { blend: buildupBlend } : {}),
          },
        ],
      },
      depthStencil: {
        format: COVERAGE_DEPTH_FORMAT,
        depthWriteEnabled: accumulation === "coverage",
        depthCompare: accumulation === "coverage" ? "less-equal" : "always",
      },
      primitive: { topology: "triangle-list" },
    })

  const stampPipelines: Record<Accumulation, GPURenderPipeline> = {
    coverage: stampPipelineFor("coverage"),
    buildup: stampPipelineFor("buildup"),
  }

  const clearRegionModule = device.createShaderModule({
    code: clearRegionShader,
  })
  const clearRegionPipeline = device.createRenderPipeline({
    label: "clear stroke region",
    layout: "auto",
    vertex: { module: clearRegionModule, entryPoint: "vertexMain" },
    fragment: {
      module: clearRegionModule,
      entryPoint: "fragmentMain",
      targets: [{ format: LAYER_FORMAT }],
    },
    depthStencil: {
      format: COVERAGE_DEPTH_FORMAT,
      depthWriteEnabled: true,
      depthCompare: "always",
    },
    primitive: { topology: "triangle-list" },
  })

  const stampInstances = device.createBuffer({
    size: MAX_STAMPS_PER_DRAW * STAMP_STRIDE * 4,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  })
  let coverageDepth: GPUTexture | undefined
  let coverageDepthView: GPUTextureView | undefined
  let clearCoverageDepth = true

  /** Applied when the stroke is composited, and shown in flight at the same value. */
  let strokeOpacity = 1
  let strokeMode: StrokeMode = "paint"

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

  /** The present pass shows the stroke in flight at the opacity it will land at. */
  function writeStrokeOpacity(opacity: number) {
    strokeOpacity = opacity
    context.showOpacity(opacity)
  }

  function writeStrokeMode(mode: StrokeMode) {
    strokeMode = mode
    context.showMode(mode)
  }

  /** The painted region in whole pixels, clipped to the buffer. Null if empty. */
  function paintedScissor() {
    if (painted.right <= painted.left) return null
    const { width, height } = context.size()
    const x = Math.max(0, Math.floor(painted.left))
    const y = Math.max(0, Math.floor(painted.top))
    const right = Math.min(width, Math.ceil(painted.right))
    const bottom = Math.min(height, Math.ceil(painted.bottom))
    if (right <= x || bottom <= y) return null
    return { x, y, width: right - x, height: bottom - y }
  }

  // Every pixel a stamp pass could have written since the buffer was last
  // cleared, in whole pixels: the union of the passes' scissor rectangles.
  const strokeDirty = { left: 0, top: 0, right: 0, bottom: 0 }

  function resetStrokeDirty() {
    strokeDirty.left = Infinity
    strokeDirty.top = Infinity
    strokeDirty.right = -Infinity
    strokeDirty.bottom = -Infinity
  }
  resetStrokeDirty()

  /**
   * Empties the stroke buffer and its coverage depth where stamps reached,
   * rather than across the document: a stroke clears what it painted.
   */
  function clearStroke() {
    const buffer = context.buffer()
    if (!buffer) throw new Error("The render target has not been sized.")
    buffer.empty = true
    if (strokeDirty.right <= strokeDirty.left) return
    const encoder = device.createCommandEncoder()
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        { view: buffer.view, loadOp: "load", storeOp: "store" },
      ],
      depthStencilAttachment: {
        view: coverageDepthView!,
        depthLoadOp: "load",
        depthStoreOp: "store",
      },
    })
    pass.setPipeline(clearRegionPipeline)
    pass.setScissorRect(
      strokeDirty.left,
      strokeDirty.top,
      strokeDirty.right - strokeDirty.left,
      strokeDirty.bottom - strokeDirty.top
    )
    pass.draw(3)
    pass.end()
    device.queue.submit([encoder.finish()])
    resetStrokeDirty()
  }

  /** Draws `count` dabs of the current stroke into the buffer. */
  function drawStamps(instances: Float32Array, offset: number, count: number) {
    const buffer = context.buffer()
    const binding = context.binding()
    if (!buffer || !binding)
      throw new Error("The render target has not been sized.")
    const { width, height } = context.size()
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
        { view: buffer.view, loadOp: "load", storeOp: "store" },
      ],
      depthStencilAttachment: {
        view: coverageDepthView!,
        depthClearValue: 1,
        depthLoadOp: clearCoverageDepth ? "clear" : "load",
        depthStoreOp: "store",
      },
    })
    clearCoverageDepth = false
    pass.setPipeline(stampPipelines[accumulation])
    pass.setBindGroup(0, binding)
    pass.setVertexBuffer(0, stampInstances)
    // Bound the pass to this batch, rather than letting a document-sized
    // depth attachment touch tiles the pen never visited. Rotated textured
    // quads fit inside sqrt(2) radii, even when their corners carry ink.
    let left = width
    let top = height
    let right = 0
    let bottom = 0
    for (let i = offset; i < offset + count; i++) {
      const index = i * STAMP_STRIDE
      const radius = instances[index + STAMP.RADIUS] * Math.SQRT2
      const x = instances[index + STAMP.CENTER_X]
      const y = instances[index + STAMP.CENTER_Y]
      left = Math.min(left, Math.max(0, Math.floor(x - radius)))
      top = Math.min(top, Math.max(0, Math.floor(y - radius)))
      right = Math.max(right, Math.min(width, Math.ceil(x + radius)))
      bottom = Math.max(bottom, Math.min(height, Math.ceil(y + radius)))
    }
    if (right > left && bottom > top) {
      pass.setScissorRect(left, top, right - left, bottom - top)
      pass.draw(6, count)
      strokeDirty.left = Math.min(strokeDirty.left, left)
      strokeDirty.top = Math.min(strokeDirty.top, top)
      strokeDirty.right = Math.max(strokeDirty.right, right)
      strokeDirty.bottom = Math.max(strokeDirty.bottom, bottom)
    }
    pass.end()
    device.queue.submit([encoder.finish()])
    buffer.empty = false
  }

  /**
   * Abandons the stroke in flight: the buffer is emptied and nothing is
   * composited.
   */
  function cancel() {
    if (!context.buffer()) return
    log.reset()
    resetPainted()
    clearStroke()
    writeStrokeOpacity(1)
  }

  /**
   * Composites the stroke buffer into the surface it lands on, once, at
   * stroke opacity. Answers the region the mark landed in, or null when the
   * stroke drew nothing.
   */
  function land(): PixelRect | null {
    const buffer = context.buffer()
    const target = context.target()
    if (!buffer || !target)
      throw new Error("There is no active layer to paint into.")
    const region = paintedScissor()
    log.reset()
    resetPainted()
    if (!region) return null
    context.land(buffer, target, strokeOpacity, region, strokeMode)
    // The mark now lives in the layer's texture; the buffer must not show it
    // a second time through the present pass.
    clearStroke()
    // Nothing between strokes should depend on the last stroke's opacity.
    writeStrokeOpacity(1)
    writeStrokeMode("paint")
    return region
  }

  return {
    bindingLayout,
    /**
     * Empties the stroke buffer and fixes how this stroke's dabs combine and
     * what the finished mark's opacity will be.
     */
    begin(opening) {
      if (!context.buffer())
        throw new Error("The render target has not been sized.")
      if (
        !Number.isFinite(opening.opacity) ||
        opening.opacity < 0 ||
        opening.opacity > 1
      )
        throw new Error("Stroke opacity must be a finite value in [0, 1].")
      clearStroke()
      resetPainted()
      log.reset()
      accumulation = opening.accumulation
      writeStrokeOpacity(opening.opacity)
      writeStrokeMode(opening.mode)
      return true
    },
    /**
     * Dabs are laid out as `STAMP` says. The caller owns the array, reuses it
     * across frames, and draws before it exceeds `MAX_STAMPS_PER_DRAW`.
     */
    draw(instances, count) {
      if (count <= 0) return
      if (count > MAX_STAMPS_PER_DRAW)
        throw new Error("Too many dabs for one draw.")
      log.append(instances, count)
      growPainted(instances, count)
      drawStamps(instances, 0, count)
    },
    end(keep) {
      if (keep) return land()
      cancel()
      return null
    },
    discard(count) {
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
    opacity: () => strokeOpacity,
    mode: () => strokeMode,
    resize() {
      coverageDepth?.destroy()
      log.reset()
      resetPainted()
      coverageDepth = device.createTexture({
        size: context.size(),
        format: COVERAGE_DEPTH_FORMAT,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      })
      coverageDepthView = coverageDepth.createView()
      // A new depth texture holds zeros, so the first stamp pass clears it
      // whole; after that only the regions stamps reached are cleared.
      clearCoverageDepth = true
      resetStrokeDirty()
      // A fresh texture is already transparent, but the previous stroke's
      // opacity is not; both passes read it from a uniform.
      writeStrokeOpacity(1)
    },
    destroy() {
      coverageDepth?.destroy()
      coverageDepth = undefined
      coverageDepthView = undefined
      stampInstances.destroy()
    },
  }
}
