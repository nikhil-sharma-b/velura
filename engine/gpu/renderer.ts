import type { Accumulation } from "../brush/round-brush"
import type { GrayscaleTexture } from "../brush/texture"
import {
  type ColorMatrix,
  type OutputColorSpace,
  workingToOutputMatrix,
} from "../color/display-transform"
import {
  intersectRect,
  type PixelRect,
  TILE_CHANNELS,
  TILE_SIZE,
  type TileCoord,
  tileBounds,
} from "../doc/tile-grid"
import {
  cacheKey,
  compositionKey,
  type CompositePlan,
  type CompositeItem,
} from "../doc/document"
import type { LinearColor, TiledLayer } from "../doc/tiled-layer"
import type { TiledMask } from "../doc/tiled-mask"
import { blendShader, type BlendMode } from "../shaders/blend-modes"
import { displayTransformShader } from "../shaders/display-transform"
import { stampShader } from "../shaders/stamp"
import { surfaceCompositeShader } from "../shaders/surface-composite"
import { STAMP, STAMP_STRIDE } from "./stamp-instance"
import { createStampLog } from "./stamp-log"

const LAYER_FORMAT: GPUTextureFormat = "rgba16float"
const BYTES_PER_TEXEL = TILE_CHANNELS * 2
/**
 * mat3x3 occupies three 16-byte columns, then one vec4 of background, then the
 * five floats the present pass needs to know about the stack and stroke.
 */
const UNIFORM_BYTES = 96
/** Where the stroke opacity sits in that buffer: after matrix and background. */
const STROKE_OPACITY_OFFSET = 64
/**
 * The active layer's opacity, followed by the two flags saying whether each
 * cache exists. All three are written together, as one plan's answer.
 */
const ACTIVE_OPACITY_OFFSET = 68
/** Whether the in-flight stroke removes coverage instead of adding it. */
const STROKE_MODE_OFFSET = 80
/**
 * vec2 viewport, feather and the tip flag, one vec4 of ink, then the grain's
 * scale and depth padded out to the 16-byte alignment a uniform requires.
 */
const STAMP_UNIFORM_BYTES = 48
/** Where the tip flag sits in that buffer: after the viewport and feather. */
const USE_TIP_OFFSET = 12
/** Where the grain's scale and depth sit: after the ink. */
const GRAIN_OFFSET = 32
/** Greyscale, because a tip is coverage and grain is how much gets through. */
const TEXTURE_FORMAT: GPUTextureFormat = "r8unorm"
/** Five f32 composite controls, padded to uniform-struct alignment. */
const COMPOSITE_UNIFORM_BYTES = 32
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

export interface Renderer {
  /** (Re)allocates every render target; layers must be uploaded again after. */
  resize(width: number, height: number): void
  /**
   * Gives a layer GPU storage, uploading the tiles its surface marked dirty
   * and clearing that mark. A layer that has never been uploaded and never
   * painted on holds no texture at all, which is what makes fifty empty
   * layers cost nothing.
   */
  uploadLayer(id: string, surface: TiledLayer): void
  /** Uploads sparse single-channel mask tiles into their GPU paint target. */
  uploadMask(id: string, surface: TiledMask): void
  /** Copies the authoritative GPU pixels into a new independent layer. */
  duplicateLayer(sourceId: string, copyId: string): void
  /** Frees a removed layer's storage. */
  releaseLayer(id: string): void
  /**
   * Sets what is composited and in what order (D19). Rebuilds the caches
   * under and over the active layer, and does nothing at all when the plan is
   * the one already in force — which is why painting, whose plan cannot
   * change, never rebuilds a cache.
   */
  setComposition(plan: CompositePlan): void
  /**
   * Opens a stroke: empties the stroke buffer and fixes how this stroke's dabs
   * combine and what the finished mark's opacity will be.
   */
  beginStroke(stroke: {
    accumulation: Accumulation
    opacity: number
    mode: StrokeMode
  }): void
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
  /**
   * Sets the dab's shape: a greyscale tip texture sampled in stamp space, or
   * the procedural feathered disc when there is none (D24).
   */
  setTip(texture: GrayscaleTexture | null): void
  /**
   * Sets the paper. `scale` sizes one tile of the texture against its own
   * pixels and `depth` is how hard it bites, both fixed for a stroke; the
   * dynamics graph varies the bite per dab on top of this.
   */
  setGrain(texture: GrayscaleTexture | null, scale: number, depth: number): void
  /** Sets the premultiplied linear-light ink used by subsequent dabs. */
  setInk(color: LinearColor): void
  /**
   * Composites the stroke buffer into the active layer, once, at stroke
   * opacity. Returns the region the mark landed in, which is the region undo
   * has to remember, or null when the stroke drew nothing.
   */
  endStroke(): PixelRect | null
  /**
   * Reads whole tiles back off a surface, zero-filled where they hang past the
   * canvas and where the surface holds nothing. Asynchronous and off the
   * interactive path: this runs on pen-up and on undo, never per frame (D30).
   */
  readTiles(id: string, coords: readonly TileCoord[]): Promise<Uint16Array[]>
  /** Puts whole tiles back onto a surface. Null texels clear the tile. */
  writeTiles(
    id: string,
    tiles: readonly (TileCoord & { texels: Uint16Array | null })[]
  ): void
  render(view: GPUTextureView): void
  destroy(): void
}

/**
 * Owns the layers' linear-light textures, the two flattened caches around the
 * active one (D19), the stroke buffer that dabs land in before the layer sees
 * them (D27), and the single display-transform pass.
 *
 * A layer's tiles are uploaded into a canvas-sized `rgba16float` texture,
 * allocated only for layers that hold something. That is affordable because
 * the caches mean an untouched layer is read once per structural change rather
 * than once per frame; per-layer sparse atlases (D-6.1) are what make a large
 * document with many *painted* layers fit, and they replace this allocation
 * without moving the seam — the compositor still sees below, active, above.
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
  const presentPipelines = new Map<BlendMode, GPURenderPipeline>()
  function presentPipeline(mode: BlendMode): GPURenderPipeline {
    const existing = presentPipelines.get(mode)
    if (existing) return existing
    const shader = device.createShaderModule({
      code: displayTransformShader(mode),
    })
    const pipeline = device.createRenderPipeline({
      label: `present:${mode}`,
      layout: "auto",
      vertex: { module: shader, entryPoint: "vertexMain" },
      fragment: {
        module: shader,
        entryPoint: "fragmentMain",
        targets: [{ format: options.format }],
      },
      primitive: { topology: "triangle-list" },
    })
    presentPipelines.set(mode, pipeline)
    return pipeline
  }
  let pipeline: GPURenderPipeline
  const blendPipelines = new Map<BlendMode, GPURenderPipeline>()
  function blendPipeline(mode: BlendMode): GPURenderPipeline {
    const existing = blendPipelines.get(mode)
    if (existing) return existing
    const shader = device.createShaderModule({ code: blendShader(mode) })
    const pipeline = device.createRenderPipeline({
      label: `blend:${mode}`,
      layout: "auto",
      vertex: { module: shader, entryPoint: "vertexMain" },
      fragment: {
        module: shader,
        entryPoint: "fragmentMain",
        targets: [{ format: LAYER_FORMAT }],
      },
      primitive: { topology: "triangle-list" },
    })
    blendPipelines.set(mode, pipeline)
    return pipeline
  }

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
        texture: { sampleType: "float" },
      },
      {
        binding: 4,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: "float" },
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
        targets: [{ format: LAYER_FORMAT, blend: stampBlends[accumulation] }],
      },
      primitive: { topology: "triangle-list" },
    })

  const stampPipelines: Record<Accumulation, GPURenderPipeline> = {
    coverage: stampPipelineFor("coverage"),
    buildup: stampPipelineFor("buildup"),
  }

  const compositeModule = device.createShaderModule({
    code: surfaceCompositeShader,
  })
  const compositeBindGroupLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: "uniform" },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: "float" },
      },
    ],
  })
  const compositePipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [compositeBindGroupLayout],
  })
  const compositePipeline = device.createRenderPipeline({
    layout: compositePipelineLayout,
    vertex: { module: compositeModule, entryPoint: "vertexMain" },
    fragment: {
      module: compositeModule,
      entryPoint: "fragmentMain",
      targets: [
        {
          format: LAYER_FORMAT,
          // A flattened surface goes over what is already there, premultiplied.
          blend: {
            color: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
            alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
          },
        },
      ],
    },
    primitive: { topology: "triangle-list" },
  })
  const erasePipeline = device.createRenderPipeline({
    layout: compositePipelineLayout,
    vertex: { module: compositeModule, entryPoint: "vertexMain" },
    fragment: {
      module: compositeModule,
      entryPoint: "fragmentMain",
      targets: [
        {
          format: LAYER_FORMAT,
          // Premultiplied destination-out: colour and alpha lose the same
          // coverage, so a later composite cannot reveal a fringe.
          blend: {
            color: { srcFactor: "zero", dstFactor: "one-minus-src-alpha" },
            alpha: { srcFactor: "zero", dstFactor: "one-minus-src-alpha" },
          },
        },
      ],
    },
    primitive: { topology: "triangle-list" },
  })

  /**
   * A brush with no texture still has to bind one, so the shader can sample
   * unconditionally: fully white is the identity for both. The tip is never
   * read while `useTip` is zero, and white grain lets every dab through whole.
   */
  function createWhiteTexture(): GPUTexture {
    const texture = device.createTexture({
      size: { width: 1, height: 1 },
      format: TEXTURE_FORMAT,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    })
    device.queue.writeTexture(
      { texture },
      new Uint8Array([255]),
      { bytesPerRow: 1 },
      { width: 1, height: 1 }
    )
    return texture
  }

  function uploadTexture(source: GrayscaleTexture): GPUTexture {
    const texture = device.createTexture({
      size: { width: source.width, height: source.height },
      format: TEXTURE_FORMAT,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    })
    device.queue.writeTexture(
      { texture },
      source.data,
      { bytesPerRow: source.width, rowsPerImage: source.height },
      { width: source.width, height: source.height }
    )
    return texture
  }

  // Linear filtering on both: a tip is magnified well past its own resolution
  // on a large dab, and grain is minified as the canvas zooms out.
  const tipSampler = device.createSampler({
    magFilter: "linear",
    minFilter: "linear",
  })
  const grainSampler = device.createSampler({
    magFilter: "linear",
    minFilter: "linear",
    addressModeU: "repeat",
    addressModeV: "repeat",
  })
  let tipTexture = createWhiteTexture()
  let grainTexture = createWhiteTexture()

  const stampUniform = device.createBuffer({
    size: STAMP_UNIFORM_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  // The parts of the stamp uniform that belong to the brush rather than to the
  // surface: written once here so a brush that sets nothing still draws in ink
  // on a smooth surface, and rewritten by `setTip` and `setGrain`.
  device.queue.writeBuffer(
    stampUniform,
    0,
    new Float32Array([1, 1, options.feather, 0, ...options.ink, 1, 0, 0, 0])
  )
  const stampInstances = device.createBuffer({
    size: MAX_STAMPS_PER_DRAW * STAMP_STRIDE * 4,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  })
  const compositeUniform = device.createBuffer({
    size: COMPOSITE_UNIFORM_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const compositeValues = new Float32Array(COMPOSITE_UNIFORM_BYTES / 4)
  const blendBindGroups = new Map<string, GPUBindGroup>()
  let stampBindGroup: GPUBindGroup | undefined

  /**
   * A canvas-sized linear-light surface, with the bind group that draws it
   * into another one. Layers, the two caches and the stroke buffer are all
   * this: what differs is only when they are written and what reads them.
   */
  type Surface = {
    id: number
    texture: GPUTexture
    view: GPUTextureView
    /** Reads this surface, for the pass that flattens it into another. */
    readBindGroup: GPUBindGroup
    /** Nothing has been written since it was allocated. */
    empty: boolean
  }

  /** One texture per layer that holds something; absent layers hold none. */
  const surfaces = new Map<string, Surface>()
  let stroke: Surface | undefined
  // Everything under and over the active layer, flattened (D19). Undefined
  // when there is nothing on that side, which is a document of one layer.
  let below: Surface | undefined
  let above: Surface | undefined
  // Blend modes above the pen depend on its live pixels and cannot be flattened
  // independently. Normal-only upper stacks retain the constant-cost path.
  let liveAbove: CompositeItem[] = []
  let activeItem: CompositeItem | undefined
  let paintTarget: Surface | undefined
  let blendScratch: Surface | undefined
  let frame: Surface | undefined
  let complexOutput: Surface | undefined
  let complexStages: CompositePlan["stages"]
  let stageBelow: (Surface | undefined)[] = []
  let stageAbove: (Surface | undefined)[] = []
  let stageClipBase: (Surface | undefined)[] = []
  let stageLiveAbove: boolean[] = []
  let stageFrames: Surface[] = []
  const groupCaches = new Map<string, Surface>()
  const validGroupCaches = new Set<string>()
  const coverageCaches = new Map<string, Surface>()
  let active: Surface | undefined
  let presentBindGroup: GPUBindGroup | undefined
  /** The plan in force. Undefined forces the next one to be applied in full. */
  let composition: string | undefined
  /** What the caches were built from, which is only part of that plan. */
  let cachedFrom: string | undefined
  let width = 0
  let height = 0
  /**
   * Bound where a cache does not exist, so the present bind group is always
   * complete. The shader is told not to read it, but a binding must resolve.
   */
  const placeholder = device.createTexture({
    size: { width: 1, height: 1 },
    format: LAYER_FORMAT,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
  })
  const placeholderView = placeholder.createView()
  /** Applied when the stroke is composited, and shown in flight at the same value. */
  let strokeOpacity = 1
  let strokeMode: StrokeMode = "paint"

  const SURFACE_USAGE =
    GPUTextureUsage.TEXTURE_BINDING |
    GPUTextureUsage.COPY_DST |
    GPUTextureUsage.COPY_SRC |
    GPUTextureUsage.RENDER_ATTACHMENT

  let nextSurfaceId = 0

  function createSurface(): Surface {
    if (width === 0) throw new Error("The render target has not been sized.")
    const texture = device.createTexture({
      size: { width, height },
      format: LAYER_FORMAT,
      usage: SURFACE_USAGE,
    })
    const view = texture.createView()
    return {
      id: ++nextSurfaceId,
      texture,
      view,
      readBindGroup: device.createBindGroup({
        layout: compositePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: compositeUniform } },
          { binding: 1, resource: view },
        ],
      }),
      // WebGPU zeroes a new texture, and zero is transparent black.
      empty: true,
    }
  }

  function ensureSurface(id: string): Surface {
    const existing = surfaces.get(id)
    if (existing) return existing
    const surface = createSurface()
    surfaces.set(id, surface)
    return surface
  }

  /**
   * Empties a surface. A clear is a load operation, which a scissor rectangle
   * does not narrow, so this is always the whole surface — it runs when a
   * stroke starts, ends or rewinds and when a cache is rebuilt, never on a
   * frame of drawing.
   */
  function clearSurface(surface: Surface) {
    const encoder = device.createCommandEncoder()
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: surface.view,
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    })
    pass.end()
    device.queue.submit([encoder.finish()])
    surface.empty = true
  }

  /** Draws one surface over another at an opacity, optionally scissored. */
  function compositeSurface(
    source: Surface,
    destination: Surface,
    opacity: number,
    region?: PixelRect,
    selectedPipeline = compositePipeline
  ) {
    // The uniform is written per composite rather than per surface: these
    // passes are rare, and one buffer is cheaper than a bind group each.
    compositeValues[0] = opacity
    compositeValues[1] = 0
    compositeValues[2] = 0
    compositeValues[3] = 0
    device.queue.writeBuffer(compositeUniform, 0, compositeValues)
    const encoder = device.createCommandEncoder()
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        { view: destination.view, loadOp: "load", storeOp: "store" },
      ],
    })
    pass.setPipeline(selectedPipeline)
    pass.setBindGroup(0, source.readBindGroup)
    if (region)
      pass.setScissorRect(region.x, region.y, region.width, region.height)
    pass.draw(3)
    pass.end()
    device.queue.submit([encoder.finish()])
    destination.empty = false
  }

  function blendBindings(
    mode: BlendMode,
    source: Surface,
    maskId: string | undefined,
    clipBase: Surface | undefined,
    usesStroke: boolean
  ): GPUBindGroup {
    blendScratch ??= createSurface()
    const mask = maskId ? surfaces.get(maskId) : undefined
    const bindingKey = `${mode}:${source.id}:${mask?.id ?? 0}:${clipBase?.id ?? 0}:${usesStroke ? 1 : 0}`
    const existing = blendBindGroups.get(bindingKey)
    if (existing) return existing
    const bindings = device.createBindGroup({
      layout: blendPipeline(mode).getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: compositeUniform } },
        { binding: 1, resource: source.view },
        { binding: 2, resource: blendScratch.view },
        {
          binding: 3,
          resource: usesStroke ? stroke!.view : placeholderView,
        },
        { binding: 4, resource: mask?.view ?? placeholderView },
        { binding: 5, resource: clipBase?.view ?? placeholderView },
      ],
    })
    blendBindGroups.set(bindingKey, bindings)
    return bindings
  }

  /** Snapshot the destination: WebGPU cannot sample a render attachment. */
  function blendSurface(
    source: Surface,
    destination: Surface,
    item: Pick<CompositeItem, "opacity" | "blend">,
    inFlight = false,
    maskId?: string,
    clipBase?: Surface,
    maskInFlight = false
  ) {
    blendScratch ??= createSurface()
    const pipeline = blendPipeline(item.blend)
    const bindings = blendBindings(
      item.blend,
      source,
      maskId,
      clipBase,
      inFlight || maskInFlight
    )
    const encoder = device.createCommandEncoder()
    encoder.copyTextureToTexture(
      { texture: destination.texture },
      { texture: blendScratch.texture },
      { width, height }
    )
    compositeValues[0] = item.opacity
    compositeValues[1] = inFlight
      ? strokeOpacity
      : maskInFlight
        ? -strokeOpacity
        : 0
    compositeValues[2] = maskId && surfaces.has(maskId) ? 1 : 0
    compositeValues[3] = clipBase ? 1 : 0
    compositeValues[4] = strokeMode === "erase" ? 1 : 0
    device.queue.writeBuffer(compositeUniform, 0, compositeValues)
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        { view: destination.view, loadOp: "load", storeOp: "store" },
      ],
    })
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, bindings)
    pass.draw(3)
    pass.end()
    device.queue.submit([encoder.finish()])
    destination.empty = false
  }

  function itemSurface(item: CompositeItem): Surface | undefined {
    if (item.kind !== "group") return surfaces.get(item.id)
    const children = item.children ?? []
    const target = groupCaches.get(item.id) ?? createSurface()
    groupCaches.set(item.id, target)
    if (validGroupCaches.has(item.id)) return target.empty ? undefined : target
    if (!target.empty) clearSurface(target)
    renderItems(children, target)
    validGroupCaches.add(item.id)
    return target.empty ? undefined : target
  }

  /** The alpha shape clipping reads, after the base item's mask and opacity. */
  function coverageSurface(
    item: CompositeItem,
    source: Surface,
    maskInFlight = false
  ): Surface {
    if (!item.maskId && item.opacity === 1 && !maskInFlight) return source
    const target = coverageCaches.get(item.id) ?? createSurface()
    coverageCaches.set(item.id, target)
    if (!target.empty) clearSurface(target)
    blendSurface(
      source,
      target,
      { opacity: item.opacity, blend: "normal" },
      false,
      item.maskId,
      undefined,
      maskInFlight
    )
    return target
  }

  function renderItems(
    items: readonly CompositeItem[],
    target: Surface,
    initialClipBase?: Surface
  ) {
    let clipBase = initialClipBase
    for (const item of items) {
      const source = itemSurface(item)
      if (!source) continue
      if (item.blend === "normal" && !item.maskId && !item.clip)
        compositeSurface(source, target, item.opacity)
      else
        blendSurface(
          source,
          target,
          item,
          false,
          item.maskId,
          item.clip ? clipBase : undefined
        )
      if (!item.clip) clipBase = coverageSurface(item, source)
    }
  }

  function prepareItems(
    items: readonly CompositeItem[],
    initialClipBase?: Surface
  ) {
    let clipBase = initialClipBase
    for (const item of items) {
      const source = itemSurface(item)
      if (!source) continue
      if (item.blend !== "normal" || item.maskId || item.clip)
        blendBindings(
          item.blend,
          source,
          item.maskId,
          item.clip ? clipBase : undefined,
          false
        )
      if (!item.clip) clipBase = coverageSurface(item, source)
    }
  }

  /**
   * Flattens one side of the stack into its cache, allocating the cache only
   * if there is anything to put in it. Layers with no texture have never held
   * a pixel, so they are skipped rather than drawn as transparent.
   */
  function buildCache(
    items: readonly CompositeItem[],
    cache: Surface | undefined
  ): Surface | undefined {
    const drawable = items.filter(
      (item) => item.kind === "group" || surfaces.has(item.id)
    )
    if (drawable.length === 0) {
      cache?.texture.destroy()
      return undefined
    }
    const target = cache ?? createSurface()
    if (!target.empty) clearSurface(target)
    renderItems(drawable, target)
    return target
  }

  function refreshPresentBindGroup() {
    if (!active || !stroke) return
    presentBindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniform } },
        {
          binding: 1,
          resource:
            complexOutput?.view ??
            frame?.view ??
            below?.view ??
            placeholderView,
        },
        { binding: 2, resource: frame ? placeholderView : active.view },
        { binding: 3, resource: frame ? placeholderView : stroke.view },
        { binding: 4, resource: above?.view ?? placeholderView },
      ],
    })
  }

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

  /** Rebuilt whenever a texture is replaced: a bind group holds views, not ids. */
  function refreshStampBindGroup() {
    stampBindGroup = device.createBindGroup({
      layout: stampBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: stampUniform } },
        { binding: 1, resource: tipSampler },
        { binding: 2, resource: grainSampler },
        { binding: 3, resource: tipTexture.createView() },
        { binding: 4, resource: grainTexture.createView() },
      ],
    })
  }

  /** The present pass shows the stroke in flight at the opacity it will land at. */
  function writeStrokeOpacity(opacity: number) {
    strokeOpacity = opacity
    device.queue.writeBuffer(
      uniform,
      STROKE_OPACITY_OFFSET,
      new Float32Array([opacity])
    )
  }

  function writeStrokeMode(mode: StrokeMode) {
    strokeMode = mode
    device.queue.writeBuffer(
      uniform,
      STROKE_MODE_OFFSET,
      new Float32Array([mode === "erase" ? 1 : 0])
    )
  }

  /** The painted region in whole pixels, clipped to the buffer. Null if empty. */
  function paintedScissor() {
    if (!stroke || painted.right <= painted.left) return null
    const x = Math.max(0, Math.floor(painted.left))
    const y = Math.max(0, Math.floor(painted.top))
    const right = Math.min(width, Math.ceil(painted.right))
    const bottom = Math.min(height, Math.ceil(painted.bottom))
    if (right <= x || bottom <= y) return null
    return { x, y, width: right - x, height: bottom - y }
  }

  function clearStroke() {
    if (!stroke) throw new Error("The render target has not been sized.")
    clearSurface(stroke)
  }

  /** Draws `count` dabs of the current stroke into the buffer. */
  function drawStamps(instances: Float32Array, offset: number, count: number) {
    if (!stroke || !stampBindGroup)
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
        { view: stroke.view, loadOp: "load", storeOp: "store" },
      ],
    })
    pass.setPipeline(stampPipelines[accumulation])
    pass.setBindGroup(0, stampBindGroup)
    pass.setVertexBuffer(0, stampInstances)
    pass.draw(6, count)
    pass.end()
    device.queue.submit([encoder.finish()])
    stroke.empty = false
  }

  return {
    resize(nextWidth, nextHeight) {
      for (const surface of surfaces.values()) surface.texture.destroy()
      surfaces.clear()
      for (const surface of groupCaches.values()) surface.texture.destroy()
      groupCaches.clear()
      validGroupCaches.clear()
      for (const surface of coverageCaches.values()) surface.texture.destroy()
      coverageCaches.clear()
      blendBindGroups.clear()
      stroke?.texture.destroy()
      below?.texture.destroy()
      above?.texture.destroy()
      blendScratch?.texture.destroy()
      frame?.texture.destroy()
      for (const surface of stageFrames) surface.texture.destroy()
      stageFrames = []
      blendScratch = undefined
      frame = undefined
      complexOutput = undefined
      complexStages = undefined
      stageBelow = []
      stageAbove = []
      stageClipBase = []
      stageLiveAbove = []
      liveAbove = []
      activeItem = undefined
      below = undefined
      above = undefined
      active = undefined
      presentBindGroup = undefined
      // The caches are gone with the textures they flattened, so the next plan
      // rebuilds them even if it is the same plan.
      composition = undefined
      cachedFrom = undefined
      log.reset()
      resetPainted()
      width = nextWidth
      height = nextHeight
      // The stroke buffer matches a layer texel for texel, so a dab lands at
      // the same pixel in both and the composite is a straight copy. §6.2 wants
      // it bounded to the stroke's region; it narrows to a tiled surface with
      // the per-layer atlases (D-6.1), which is what bounds a layer too.
      stroke = createSurface()
      // Only the viewport changes with a resize; the tip flag, the ink and the
      // grain settings are the brush's and outlive it.
      device.queue.writeBuffer(
        stampUniform,
        0,
        new Float32Array([width, height, options.feather])
      )
      refreshStampBindGroup()
      // A fresh texture is already transparent, but the previous stroke's
      // opacity is not; both passes read it from a uniform.
      writeStrokeOpacity(1)
    },
    uploadLayer(id, layer) {
      // A layer with no tiles has never held a pixel, and allocating a
      // canvas-sized texture to hold nothing is what would make a document of
      // fifty layers expensive. The active layer gets its storage from
      // `setComposition` instead, because it is about to be drawn into.
      if (!surfaces.has(id) && layer.tileCount() === 0) return
      const surface = ensureSurface(id)
      const dirty = layer.dirtyBounds()
      if (!surface.empty && !dirty) return
      const canvas = { x: 0, y: 0, width, height }
      let wrote = false
      for (const tile of layer.tiles()) {
        const bounds = tileBounds(tile)
        // Edge tiles hang past the canvas; upload only the visible sub-rect.
        const visible = intersectRect(bounds, canvas)
        if (!visible) continue
        if (!surface.empty && dirty && !intersectRect(bounds, dirty)) continue
        device.queue.writeTexture(
          { texture: surface.texture, origin: { x: visible.x, y: visible.y } },
          tile.texels,
          { bytesPerRow: TILE_SIZE * BYTES_PER_TEXEL, rowsPerImage: TILE_SIZE },
          { width: visible.width, height: visible.height }
        )
        wrote = true
      }
      layer.clearDirty()
      // An upload that wrote nothing changes nothing: the surface is as empty
      // as it was, and the caches were built from pixels that still stand.
      if (!wrote) return
      surface.empty = false
      // A layer whose pixels arrived from outside a stroke may be inside a
      // cache, and the cache was flattened before they existed.
      composition = undefined
      cachedFrom = undefined
    },
    uploadMask(id, mask) {
      if (!surfaces.has(id) && mask.tileCount() === 0) return
      const surface = ensureSurface(id)
      const dirty = mask.dirtyBounds()
      if (!surface.empty && !dirty) return
      const canvas = { x: 0, y: 0, width, height }
      let wrote = false
      for (const tile of mask.tiles()) {
        const bounds = tileBounds(tile)
        const visible = intersectRect(bounds, canvas)
        if (!visible) continue
        if (!surface.empty && dirty && !intersectRect(bounds, dirty)) continue
        // Masks stay single-channel in the document. The current paint target
        // is RGBA, so expand only while uploading and put coverage in alpha.
        const rgba = new Uint16Array(TILE_SIZE * TILE_SIZE * TILE_CHANNELS)
        for (let texel = 0; texel < tile.texels.length; texel++)
          rgba[texel * TILE_CHANNELS + 3] = tile.texels[texel]
        device.queue.writeTexture(
          { texture: surface.texture, origin: { x: visible.x, y: visible.y } },
          rgba,
          { bytesPerRow: TILE_SIZE * BYTES_PER_TEXEL, rowsPerImage: TILE_SIZE },
          { width: visible.width, height: visible.height }
        )
        wrote = true
      }
      mask.clearDirty()
      if (!wrote) return
      surface.empty = false
      composition = undefined
      cachedFrom = undefined
    },
    duplicateLayer(sourceId, copyId) {
      const source = surfaces.get(sourceId)
      // An absent surface is an empty layer, which should stay allocation-free.
      if (!source) return
      const copy = ensureSurface(copyId)
      const encoder = device.createCommandEncoder()
      encoder.copyTextureToTexture(
        { texture: source.texture },
        { texture: copy.texture },
        { width, height }
      )
      device.queue.submit([encoder.finish()])
      copy.empty = source.empty
    },
    releaseLayer(id) {
      surfaces.get(id)?.texture.destroy()
      groupCaches.get(id)?.texture.destroy()
      coverageCaches.get(id)?.texture.destroy()
      const releasedSurface = surfaces.delete(id)
      const releasedGroup = groupCaches.delete(id)
      validGroupCaches.delete(id)
      const releasedCoverage = coverageCaches.delete(id)
      if (releasedSurface || releasedGroup || releasedCoverage) {
        blendBindGroups.clear()
        composition = undefined
        cachedFrom = undefined
      }
    },
    setComposition(plan) {
      if (!stroke) throw new Error("The render target has not been sized.")
      if (!plan.active) throw new Error("A composition needs an active layer.")
      const key = compositionKey(plan)
      if (key === composition) return
      composition = key
      validGroupCaches.clear()
      active = ensureSurface(plan.active.id)
      paintTarget = ensureSurface(plan.paintTargetId ?? plan.active.id)
      const plannedStages = plan.stages
      const complex =
        !!plannedStages &&
        (plannedStages.length > 1 ||
          !!plan.active.maskId ||
          plan.active.clip ||
          plan.paintTargetId !== plan.active.id)
      if (complex) {
        complexStages = plannedStages
        liveAbove = []
        activeItem = { ...plan.active }
        pipeline = presentPipeline("normal")
        stageBelow = complexStages!.map((stage, index) =>
          buildCache(stage.below, stageBelow[index])
        )
        stageClipBase = complexStages!.map((stage) => {
          const base = [...stage.below].reverse().find((item) => !item.clip)
          const source = base ? itemSurface(base) : undefined
          return base && source ? coverageSurface(base, source) : undefined
        })
        stageLiveAbove = complexStages!.map(
          (stage) =>
            stage.above[0]?.clip === true ||
            stage.above.some((item) => item.blend !== "normal")
        )
        stageAbove = complexStages!.map((stage, index) =>
          stageLiveAbove[index]
            ? undefined
            : buildCache(stage.above, stageAbove[index])
        )
        while (stageFrames.length < complexStages!.length)
          stageFrames.push(createSurface())
        complexOutput = stageFrames[complexStages!.length - 1]
        let source = active
        let sourceItem = activeItem
        for (let index = 0; index < complexStages!.length; index++) {
          const clipBase = sourceItem!.clip ? stageClipBase[index] : undefined
          blendBindings(
            sourceItem!.blend,
            source!,
            sourceItem!.maskId,
            clipBase,
            index === 0
          )
          if (stageLiveAbove[index]) {
            const aboveBase = sourceItem!.clip
              ? stageClipBase[index]
              : coverageSurface(
                  sourceItem!,
                  source!,
                  index === 0 && paintTarget !== active
                )
            prepareItems(complexStages![index].above, aboveBase)
          }
          source = stageFrames[index]
          sourceItem = complexStages![index].container ?? sourceItem
        }
        device.queue.writeBuffer(
          uniform,
          ACTIVE_OPACITY_OFFSET,
          new Float32Array([0, 1, 0])
        )
        refreshPresentBindGroup()
        return
      }
      complexStages = undefined
      complexOutput = undefined
      // Flattening is the expensive half, and most plans do not change what
      // goes into it: fading the active layer or selecting nothing new leaves
      // both caches exactly as they are.
      activeItem = { ...plan.active }
      liveAbove = plan.above.some((item) => item.blend !== "normal")
        ? plan.above.map((item) => ({ ...item }))
        : []
      if (liveAbove.length) frame ??= createSurface()
      else {
        frame?.texture.destroy()
        frame = undefined
      }
      pipeline = presentPipeline(frame ? "normal" : plan.active.blend)
      const caches = cacheKey(plan)
      if (caches !== cachedFrom) {
        cachedFrom = caches
        below = buildCache(plan.below, below)
        above = buildCache(frame ? [] : plan.above, above)
      }
      // The active layer is drawn into, so it needs storage whether or not it
      // has ever held a pixel.
      device.queue.writeBuffer(
        uniform,
        ACTIVE_OPACITY_OFFSET,
        new Float32Array([
          frame ? 0 : plan.active.opacity,
          frame || below ? 1 : 0,
          above ? 1 : 0,
        ])
      )
      refreshPresentBindGroup()
    },
    beginStroke(options) {
      if (!stroke) throw new Error("The render target has not been sized.")
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
      writeStrokeMode(options.mode)
    },
    stamp(instances, count) {
      if (count <= 0) return
      if (count > MAX_STAMPS_PER_DRAW)
        throw new Error("Too many dabs for one draw.")
      log.append(instances, count)
      growPainted(instances, count)
      drawStamps(instances, 0, count)
    },
    setTip(texture) {
      tipTexture.destroy()
      tipTexture = texture ? uploadTexture(texture) : createWhiteTexture()
      device.queue.writeBuffer(
        stampUniform,
        USE_TIP_OFFSET,
        new Float32Array([texture ? 1 : 0])
      )
      refreshStampBindGroup()
    },
    setGrain(texture, scale, depth) {
      if (!Number.isFinite(scale) || scale <= 0)
        throw new Error("Grain scale must be positive.")
      if (!Number.isFinite(depth) || depth < 0 || depth > 1)
        throw new Error("Grain depth must be a finite value in [0, 1].")
      grainTexture.destroy()
      grainTexture = texture ? uploadTexture(texture) : createWhiteTexture()
      device.queue.writeBuffer(
        stampUniform,
        GRAIN_OFFSET,
        // A brush with no grain texture keeps a depth of zero whatever it
        // asked for: white paper bites nothing, and saying so is cheaper.
        new Float32Array([scale, texture ? depth : 0])
      )
      refreshStampBindGroup()
    },
    setInk(color) {
      if (
        color.length !== 4 ||
        color.some(
          (channel) => !Number.isFinite(channel) || channel < 0 || channel > 1
        )
      )
        throw new Error("Ink must be a finite linear colour in [0, 1].")
      device.queue.writeBuffer(stampUniform, 16, new Float32Array(color))
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
      if (!stroke || !paintTarget)
        throw new Error("There is no active layer to paint into.")
      const region = paintedScissor()
      log.reset()
      resetPainted()
      if (!region) return null
      // The mark goes into the layer at the stroke's opacity, once (D27).
      compositeSurface(
        stroke,
        paintTarget,
        strokeOpacity,
        region,
        strokeMode === "erase" ? erasePipeline : compositePipeline
      )
      // The mark now lives in the layer's texture; the buffer must not show it
      // a second time through the present pass.
      clearStroke()
      // Nothing between strokes should depend on the last stroke's opacity.
      writeStrokeOpacity(1)
      writeStrokeMode("paint")
      return region
    },
    async readTiles(id, coords) {
      const surface = surfaces.get(id)
      const blank = () => new Uint16Array(TILE_SIZE * TILE_SIZE * TILE_CHANNELS)
      // A surface with no texture has never held a pixel, so every tile of it
      // reads as transparent without asking the GPU anything.
      if (!surface || coords.length === 0) return coords.map(blank)
      const canvas = { x: 0, y: 0, width, height }
      const stride = TILE_SIZE * BYTES_PER_TEXEL
      const tileBytes = stride * TILE_SIZE
      const buffer = device.createBuffer({
        size: tileBytes * coords.length,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      })
      try {
        const encoder = device.createCommandEncoder()
        const regions = coords.map((coord) =>
          intersectRect(tileBounds(coord), canvas)
        )
        regions.forEach((visible, index) => {
          if (!visible) return
          encoder.copyTextureToBuffer(
            {
              texture: surface.texture,
              origin: { x: visible.x, y: visible.y },
            },
            {
              buffer,
              offset: index * tileBytes,
              bytesPerRow: stride,
              rowsPerImage: TILE_SIZE,
            },
            { width: visible.width, height: visible.height }
          )
        })
        device.queue.submit([encoder.finish()])
        await buffer.mapAsync(GPUMapMode.READ)
        const mapped = new Uint16Array(buffer.getMappedRange())
        return coords.map((_, index) => {
          const texels = blank()
          if (!regions[index]) return texels
          const start = (index * tileBytes) / 2
          texels.set(mapped.subarray(start, start + texels.length))
          return texels
        })
      } finally {
        buffer.destroy()
      }
    },
    writeTiles(id, tiles) {
      if (tiles.length === 0) return
      const surface = ensureSurface(id)
      const canvas = { x: 0, y: 0, width, height }
      const blank = new Uint16Array(TILE_SIZE * TILE_SIZE * TILE_CHANNELS)
      for (const tile of tiles) {
        const visible = intersectRect(tileBounds(tile), canvas)
        if (!visible) continue
        device.queue.writeTexture(
          { texture: surface.texture, origin: { x: visible.x, y: visible.y } },
          tile.texels ?? blank,
          { bytesPerRow: TILE_SIZE * BYTES_PER_TEXEL, rowsPerImage: TILE_SIZE },
          { width: visible.width, height: visible.height }
        )
      }
      surface.empty = false
      // These pixels may sit inside a cache that was flattened before them.
      composition = undefined
      cachedFrom = undefined
    },
    render(view) {
      if (!presentBindGroup)
        throw new Error("No composition has been set to present.")
      if (complexStages) {
        let current = active!
        let currentItem = activeItem!
        for (let index = 0; index < complexStages.length; index++) {
          const target = stageFrames[index]
          clearSurface(target)
          if (stageBelow[index]) compositeSurface(stageBelow[index]!, target, 1)
          blendSurface(
            current,
            target,
            currentItem,
            index === 0 && paintTarget === active,
            currentItem.maskId,
            currentItem.clip ? stageClipBase[index] : undefined,
            index === 0 && paintTarget !== active
          )
          if (stageLiveAbove[index]) {
            const aboveBase = currentItem.clip
              ? stageClipBase[index]
              : coverageSurface(
                  currentItem,
                  current,
                  index === 0 && paintTarget !== active
                )
            renderItems(complexStages[index].above, target, aboveBase)
          } else if (stageAbove[index]) {
            compositeSurface(stageAbove[index]!, target, 1)
          }
          current = target
          const container = complexStages[index].container
          if (container) currentItem = container
        }
        complexOutput = current
      } else if (frame) {
        clearSurface(frame)
        if (below) compositeSurface(below, frame, 1)
        blendSurface(active!, frame, activeItem!, true)
        for (const item of liveAbove) {
          const source = surfaces.get(item.id)
          if (source) blendSurface(source, frame, item)
        }
      }
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
      pass.setBindGroup(0, presentBindGroup)
      pass.draw(3)
      pass.end()
      device.queue.submit([encoder.finish()])
    },
    destroy() {
      for (const surface of surfaces.values()) surface.texture.destroy()
      surfaces.clear()
      for (const surface of groupCaches.values()) surface.texture.destroy()
      groupCaches.clear()
      validGroupCaches.clear()
      for (const surface of coverageCaches.values()) surface.texture.destroy()
      coverageCaches.clear()
      blendBindGroups.clear()
      stroke?.texture.destroy()
      below?.texture.destroy()
      above?.texture.destroy()
      blendScratch?.texture.destroy()
      frame?.texture.destroy()
      for (const surface of stageFrames) surface.texture.destroy()
      stageFrames = []
      blendScratch = undefined
      frame = undefined
      liveAbove = []
      activeItem = undefined
      stroke = undefined
      below = undefined
      above = undefined
      active = undefined
      presentBindGroup = undefined
      stampBindGroup = undefined
      composition = undefined
      cachedFrom = undefined
      placeholder.destroy()
      tipTexture.destroy()
      grainTexture.destroy()
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
  // Stroke opacity, rewritten per stroke; opaque until one begins. The active
  // layer is opaque, and the cache flags stay zero until a composition sets them.
  data[STROKE_OPACITY_OFFSET / 4] = 1
  data[ACTIVE_OPACITY_OFFSET / 4] = 1
  return data
}
