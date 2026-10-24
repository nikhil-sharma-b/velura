import { type PixelRect, TILE_SIZE } from "../doc/tile-grid"
import type { LinearColor } from "../doc/tiled-layer"
import { brushLoadShader } from "../shaders/brush-load"
import { smudgeShader } from "../shaders/smudge"
import {
  RUN_DAB,
  RUN_DAB_BYTES,
  RUN_DAB_FLOATS,
  RUN_WORKGROUP,
  smudgeRunShader,
} from "../shaders/smudge-run"
import { DAB_RECT, DAB_RECT_STRIDE, dabRunEnd } from "./dab-run"
import {
  MAX_SMUDGE_DABS_PER_DRAW,
  SMUDGE,
  SMUDGE_INSTANCE_STRIDE,
  SMUDGE_STRIDE,
} from "./smudge-dab"
import type { StrokeMark, StrokeRenderer } from "./stroke-renderer"
import { LAYER_FORMAT, type Surface } from "./surface"

/** A pixel's tile is its coordinate shifted down by this. */
const TILE_SHIFT = Math.log2(TILE_SIZE)

/** What the direct stroke reads of the renderer it draws for. */
export type DirectStrokeContext = {
  /** The document's size in pixels. */
  size(): { width: number; height: number }
  /** The dab's shape: the brush's tip, or the procedural disc and its rim. */
  tip(): {
    texture: GPUTexture
    sampler: GPUSampler
    /** Whether the texture is the dab's shape rather than the disc. */
    usesTip: boolean
    feather: number
  }
  /** The paper a wet brush's laid colour is bitten by, and how hard. */
  grain(): {
    texture: GPUTexture
    sampler: GPUSampler
    scale: number
    depth: number
    movement: number
  }
  /** The selection's coverage and bounds, while there is one. */
  selection(): { texture: GPUTexture; bounds: PixelRect } | undefined
  /** Bound for the selection while nothing is selected; the shader skips it. */
  noSelection: GPUTexture
  /**
   * The widest region a run of dragging dabs may share, where the default is
   * not wanted: zero sends every dab to a pass of its own, which is how a
   * test holds the two to the same smear (live brushes 27).
   */
  runSize?: number
  /** Test control: deposit directly into the full layer instead of scratch. */
  wetTarget?: "layer" | "scratch"
  /** Test control: retain raster-interpolated procedural pickup coordinates. */
  legacyPickup?: boolean
}

/**
 * Visible artwork as it stood at pen-down, frozen where the stroke reads
 * (live brushes 21) and held nowhere else.
 */
export type FrozenArtwork = {
  /** Whether the picture held nothing as the stroke opened. */
  empty: boolean
  /**
   * Freezes whatever of a rectangle is not yet. Called for a dab's whole
   * neighbourhood before the dab is drawn, and before any drawn with it.
   */
  reach(left: number, top: number, right: number, bottom: number): void
  /** Copies a rectangle already reached into the corner of a texture. */
  copy(
    encoder: GPUCommandEncoder,
    left: number,
    top: number,
    width: number,
    height: number,
    to: GPUTexture
  ): void
  /** The stroke is over: what was frozen for it is let go. */
  release(): void
}

/** What the direct stroke is told as it opens. */
export type DirectOpening = {
  /** The surface the stroke reads and writes. */
  target: Surface
  /**
   * The colour a wet brush lays, premultiplied and in linear light. Null is
   * smudge, which lays nothing whatever flow its dabs name.
   */
  lay: LinearColor | null
  /** Keep the picked-up load after this stroke, instead of cleaning it. */
  retain?: boolean
  /** Frozen visible artwork at pen-down; destination always stays live. */
  source?: FrozenArtwork
}

/**
 * The direct stroke, and what the renderer has to tell it about the things
 * it holds on to between dabs.
 */
export interface DirectStroke extends StrokeRenderer<DirectOpening> {
  /** Discard the brush load so the next wet stroke starts with its ink. */
  cleanBrush(): void
  /** Whether the brush has picked up paint, including transparency. */
  brushDirty(): boolean
  /**
   * Keeps what a wet stroke's first dab draws into from going cold (live
   * brushes 24): the load, which pen-down clears and the dab picks up into.
   */
  warm(encoder: GPUCommandEncoder): void
  /** Initialize the extra sampled-artwork carry before a pen can need it. */
  prepareSampling(): void
  /**
   * The tip, the grain or the selection was replaced: the views held of them
   * are stale.
   */
  invalidateBinding(): void
  /**
   * Cancels a stroke whose surface is going away, restoring its brush load.
   * Without a surface, drops the document and cleans the brush too.
   */
  drop(surface?: Surface): void
  destroy(): void
}

/** Tiles to a side of one page of the backup. */
const BACKUP_PAGE_TILES = 8
const BACKUP_PAGE_SLOTS = BACKUP_PAGE_TILES * BACKUP_PAGE_TILES
/**
 * Pages kept from one stroke to the next (live brushes 20): 256 tiles, which
 * is what one spacing step of the densest scatter reaches with a 512 px dab
 * thrown wide. A stroke that needs no more than these allocates nothing once
 * a stroke before it has, the frame it opens in least of all.
 */
const BACKUP_PAGES_KEPT = 4
/** The widest neighbourhood a dab may ask for; one reaching further is skipped. */
const MAX_CARRY_SIZE = 2048
/**
 * The widest region a run of dragging dabs may share (live brushes 22). A
 * frame's worth of small dabs fits; a dab too large to is drawn on its own,
 * and by then a frame holds few.
 */
const RUN_SIZE = 256

/**
 * The stroke that reads and writes its surface as it goes (D29, smudge 01):
 * smudge mixes towards the pixel one dab behind, a run of dabs to a compute
 * pass (live brushes 22). Wet brushes exchange paint with a reservoir held in
 * tip coordinates (D41), optionally kept between strokes.
 */
export function createDirectStroke(
  device: GPUDevice,
  context: DirectStrokeContext
): DirectStroke {
  // The stroke in flight: the surface it smears, where the tip last was, the
  // region the dabs have reached, and the tiles kept as they were before a
  // dab first wrote to them (smudge 06).
  let session:
    | {
        target: Surface
        source?: FrozenArtwork
        /** Whether the stroke lays colour: a wet brush's, and not smudge's. */
        lays: boolean
        /** The clean load, until the first dab supplies its colour offsets. */
        load: LinearColor | null
        retain: boolean
        beforeDirty: boolean
        beforeExtent: number
        /** Whether the surface held nothing as the stroke opened. */
        wasEmpty: boolean
        /** Null until the first dab says where the stroke began. */
        last: { x: number; y: number } | null
        reached: { left: number; top: number; right: number; bottom: number }
        /**
         * Where each kept tile is in the backup, by its place in the grid
         * counted along the rows; slots are handed out in the order taken.
         */
        kept: Map<number, number>
      }
    | undefined
  /**
   * What a cancelled stroke is put back from: the tiles its dabs wrote to,
   * each copied out the first time one did. The stroke's size and not the
   * document's, so the frame a stroke opens in pays for a dab's tiles alone.
   * In pages, so more room is a new texture and never a move of what is
   * kept; up to `BACKUP_PAGES_KEPT` stay between strokes.
   */
  const backupPages: GPUTexture[] = []
  /**
   * What a dab reads: its own neighbourhood of the surface, copied out
   * because a pass cannot read what it writes. As wide as a dab may ask
   * for and allocated once, as the reservoir is, so no dab ever waits on a
   * larger one being made (D30).
   */
  const carry = device.createTexture({
    label: "smudge carry",
    size: { width: MAX_CARRY_SIZE, height: MAX_CARRY_SIZE },
    format: LAYER_FORMAT,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  })
  // Sampled strokes read the live destination here. Active-layer wet
  // strokes use it as a local render target, avoiding a full-layer attachment
  // load/store for each dab (live brushes 29). Both share the existing capacity.
  const destinationCarry = device.createTexture({
    label: "direct destination carry",
    size: { width: MAX_CARRY_SIZE, height: MAX_CARRY_SIZE },
    mipLevelCount: Math.log2(MAX_CARRY_SIZE / 64) + 1,
    format: LAYER_FORMAT,
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.COPY_SRC |
      GPUTextureUsage.RENDER_ATTACHMENT |
      GPUTextureUsage.STORAGE_BINDING,
  })
  const destinationViews = Array.from(
    { length: destinationCarry.mipLevelCount },
    (_, level) =>
      destinationCarry.createView({ baseMipLevel: level, mipLevelCount: 1 })
  )
  const destinationView = destinationViews[0]
  let samplingPrepared = false
  /**
   * What a run of dragging dabs is worked in (live brushes 22): its region
   * of the surface, read from one and written to the other dab by dab.
   */
  const runTextures = [0, 1].map(() =>
    device.createTexture({
      label: "smudge run",
      size: { width: RUN_SIZE, height: RUN_SIZE },
      format: LAYER_FORMAT,
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.COPY_SRC |
        GPUTextureUsage.COPY_DST,
    })
  )
  const runLimit = Math.min(context.runSize ?? RUN_SIZE, RUN_SIZE)
  // A block per dab, picked by a dynamic offset: filled per call, not
  // allocated per call.
  const runParams = new Float32Array(MAX_SMUDGE_DABS_PER_DRAW * RUN_DAB_FLOATS)
  const runUniform = device.createBuffer({
    size: runParams.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const runOffsets = Uint32Array.from(
    { length: MAX_SMUDGE_DABS_PER_DRAW },
    (_, dab) => dab * RUN_DAB_FLOATS * 4
  )
  const runRegion = new Int32Array(4)
  // Written by hand: a dynamic offset is not something a layout is given
  // from the shader.
  const runLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { hasDynamicOffset: true, minBindingSize: RUN_DAB_BYTES },
      },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, sampler: {} },
      {
        binding: 2,
        visibility: GPUShaderStage.COMPUTE,
        texture: { viewDimension: "2d-array" },
      },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, sampler: {} },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, texture: {} },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, texture: {} },
      { binding: 6, visibility: GPUShaderStage.COMPUTE, texture: {} },
      {
        binding: 7,
        visibility: GPUShaderStage.COMPUTE,
        storageTexture: { format: LAYER_FORMAT },
      },
    ],
  })
  const runPipeline = device.createComputePipeline({
    label: "smudge run",
    layout: device.createPipelineLayout({ bindGroupLayouts: [runLayout] }),
    compute: {
      module: device.createShaderModule({ code: smudgeRunShader }),
      entryPoint: "runMain",
    },
  })
  const wetDabLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: {} },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, sampler: {} },
      {
        binding: 2,
        visibility: GPUShaderStage.COMPUTE,
        texture: { viewDimension: "2d-array" },
      },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, sampler: {} },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, texture: {} },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, texture: {} },
      {
        binding: 12,
        visibility: GPUShaderStage.COMPUTE,
        storageTexture: { format: LAYER_FORMAT },
      },
      { binding: 8, visibility: GPUShaderStage.COMPUTE, texture: {} },
      {
        binding: 10,
        visibility: GPUShaderStage.COMPUTE,
        storageTexture: { format: LAYER_FORMAT },
      },
      {
        binding: 11,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { hasDynamicOffset: true, minBindingSize: 64 },
      },
    ],
  })
  /** By which of the two textures a dab reads. */
  let runBindings: GPUBindGroup[] = []
  /**
   * Holds the tip's, the carry's, the selection's and the grain's views, so
   * it goes when the tip, the selection or the grain is replaced.
   */
  let samplesArtwork = false
  let bindGroup: GPUBindGroup | undefined
  const params = new Float32Array(12)
  const shaderModule = device.createShaderModule({ code: smudgeShader })
  const pipelineDescriptor: GPURenderPipelineDescriptor = {
    label: "smudge",
    layout: "auto",
    vertex: {
      module: shaderModule,
      entryPoint: "vertexMain",
      buffers: [
        {
          arrayStride: SMUDGE_INSTANCE_STRIDE * 4,
          stepMode: "instance",
          attributes: [
            {
              shaderLocation: 0,
              offset: SMUDGE.CENTER_X * 4,
              format: "float32x2",
            },
            { shaderLocation: 1, offset: SMUDGE.RADIUS * 4, format: "float32" },
            {
              shaderLocation: 2,
              offset: SMUDGE.STRENGTH * 4,
              format: "float32",
            },
            { shaderLocation: 3, offset: SMUDGE.ANGLE * 4, format: "float32" },
            {
              shaderLocation: 4,
              offset: SMUDGE.ROUNDNESS * 4,
              format: "float32",
            },
            {
              shaderLocation: 5,
              offset: SMUDGE.TIP_FRAME * 4,
              format: "float32",
            },
            {
              shaderLocation: 6,
              offset: SMUDGE.TRAVEL_X * 4,
              format: "float32x2",
            },
            {
              shaderLocation: 7,
              offset: SMUDGE.ORIGIN_X * 4,
              format: "float32x2",
            },
            { shaderLocation: 8, offset: SMUDGE.FLOW * 4, format: "float32" },
            {
              shaderLocation: 9,
              offset: SMUDGE.GRAIN_DEPTH * 4,
              format: "float32",
            },
          ],
        },
      ],
    },
    fragment: {
      module: shaderModule,
      entryPoint: "fragmentMain",
      // No blending: the pass writes the mix itself.
      targets: [{ format: LAYER_FORMAT }],
    },
    primitive: { topology: "triangle-list" },
  }
  const pipeline = device.createRenderPipeline(pipelineDescriptor)
  const reservoirPipeline = device.createRenderPipeline({
    ...pipelineDescriptor,
    label: "brush reservoir pickup",
    vertex: {
      ...pipelineDescriptor.vertex,
      module: shaderModule,
      entryPoint: "reservoirVertex",
    },
    fragment: {
      ...pipelineDescriptor.fragment!,
      module: shaderModule,
      entryPoint: "reservoirFragment",
    },
  })
  // Maximum direct-tip capacity, allocated once. Only a first-dab-sized
  // square is used; its coordinates stay fixed through geometry dynamics.
  const reservoirSize = MAX_CARRY_SIZE
  const reservoirs = [0, 1].map(() =>
    device.createTexture({
      label: "brush reservoir",
      size: [reservoirSize, reservoirSize],
      format: LAYER_FORMAT,
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.RENDER_ATTACHMENT |
        GPUTextureUsage.COPY_SRC |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.STORAGE_BINDING,
    })
  )
  const reservoirBackup = device.createTexture({
    label: "brush load before stroke",
    size: [reservoirSize, reservoirSize],
    format: LAYER_FORMAT,
    usage: GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST,
  })
  let dirty = false
  const reservoirViews = reservoirs.map((texture) => texture.createView())
  let reservoirExtent = 0
  let reservoirIndex = 0
  let reservoirBindings: { layer: GPUBindGroup; pickup: GPUBindGroup }[] = []
  const wetDabPipeline = device.createComputePipeline({
    label: "wet dab",
    layout: device.createPipelineLayout({ bindGroupLayouts: [wetDabLayout] }),
    compute: { module: shaderModule, entryPoint: "wetDabMain" },
  })
  const wetPickupPipeline = device.createComputePipeline({
    label: "wet pickup",
    layout: device.createPipelineLayout({ bindGroupLayouts: [wetDabLayout] }),
    compute: { module: shaderModule, entryPoint: "pickupMain" },
  })
  let wetDabBindings: GPUBindGroup[][][] = []
  let wetDabTarget: GPUTexture | undefined
  const loadModule = device.createShaderModule({ code: brushLoadShader })
  const loadPipeline = device.createRenderPipeline({
    label: "wet brush colour load",
    layout: "auto",
    vertex: { module: loadModule, entryPoint: "vertexMain" },
    fragment: {
      module: loadModule,
      entryPoint: "fragmentMain",
      targets: [{ format: LAYER_FORMAT }],
    },
    primitive: { topology: "triangle-list" },
  })
  const loadParams = new Float32Array(8)
  const loadUniform = device.createBuffer({
    size: loadParams.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const loadBinding = device.createBindGroup({
    layout: loadPipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: loadUniform } }],
  })

  function tintLoad(color: LinearColor, dabs: Float32Array) {
    loadParams.set(color)
    loadParams[4] = dabs[SMUDGE.HUE]
    loadParams[5] = dabs[SMUDGE.SATURATION]
    loadParams[6] = dabs[SMUDGE.LIGHTNESS]
    if (loadParams[4] === 0 && loadParams[5] === 0 && loadParams[6] === 0)
      return
    device.queue.writeBuffer(loadUniform, 0, loadParams)
    const encoder = device.createCommandEncoder()
    for (const view of reservoirViews) {
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view, loadOp: "clear", storeOp: "store" }],
      })
      pass.setViewport(0, 0, reservoirExtent, reservoirExtent, 0, 1)
      pass.setPipeline(loadPipeline)
      pass.setBindGroup(0, loadBinding)
      pass.draw(3)
      pass.end()
    }
    device.queue.submit([encoder.finish()])
  }

  function clearReservoir(color: LinearColor = [0, 0, 0, 0]) {
    const encoder = device.createCommandEncoder()
    for (const view of reservoirViews) {
      encoder
        .beginRenderPass({
          colorAttachments: [
            {
              view,
              loadOp: "clear",
              storeOp: "store",
              clearValue: {
                r: color[0],
                g: color[1],
                b: color[2],
                a: color[3],
              },
            },
          ],
        })
        .end()
    }
    device.queue.submit([encoder.finish()])
    dirty = false
    reservoirExtent = 0
    reservoirIndex = 0
  }
  const uniform = device.createBuffer({
    size: params.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const instances = device.createBuffer({
    size: MAX_SMUDGE_DABS_PER_DRAW * SMUDGE_INSTANCE_STRIDE * 4,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  })
  const carrySampler = device.createSampler({
    magFilter: "linear",
    minFilter: "linear",
  })
  // Filled per call rather than allocated per call: the dabs as they are
  // drawn, and for each the rectangle copied out and the one drawn into.
  const drawnDabs = new Float32Array(
    MAX_SMUDGE_DABS_PER_DRAW * SMUDGE_INSTANCE_STRIDE
  )
  const rects = new Int32Array(MAX_SMUDGE_DABS_PER_DRAW * DAB_RECT_STRIDE)

  /** Draws the dabs of the stroke into its surface, one after another. */

  function drawDabs(dabs: Float32Array, count: number) {
    const stroke = session!
    if (stroke.load) {
      reservoirExtent = Math.min(
        reservoirSize,
        Math.max(64, Math.ceil(dabs[SMUDGE.RADIUS] * 2))
      )
      tintLoad(stroke.load, dabs)
      stroke.load = null
    }
    const { width, height } = context.size()
    const selection = context.selection()
    // Selection bounds clip writes; reservoir pickup still reads the whole tip.
    const bounds = selection?.bounds
    const clipLeft = bounds ? Math.max(0, bounds.x) : 0
    const clipTop = bounds ? Math.max(0, bounds.y) : 0
    const clipRight = bounds ? Math.min(width, bounds.x + bounds.width) : width
    const clipBottom = bounds
      ? Math.min(height, bounds.y + bounds.height)
      : height
    let drawn = 0
    for (let i = 0; i < count; i++) {
      const dab = i * SMUDGE_STRIDE
      const x = dabs[dab + SMUDGE.CENTER_X]
      const y = dabs[dab + SMUDGE.CENTER_Y]
      // The first dab has come from nowhere.
      stroke.last ??= { x, y }
      const travelX = x - stroke.last.x
      const travelY = y - stroke.last.y
      stroke.last.x = x
      stroke.last.y = y
      const flow = stroke.lays ? dabs[dab + SMUDGE.FLOW] : 0
      // Smudge needs travel and existing paint. Wet pickup may update the
      // reservoir even with no flow, without changing the layer or history.
      const drags =
        !stroke.lays &&
        (travelX !== 0 || travelY !== 0) &&
        dabs[dab + SMUDGE.STRENGTH] > 0 &&
        !(stroke.source ?? stroke.target).empty
      const picksUp = stroke.lays && dabs[dab + SMUDGE.STRENGTH] > 0
      if (!drags && !(flow > 0) && !picksUp) continue
      // Wet quads need their actual rotated bounds, not the square that
      // covers every possible angle. A pixel guards f32 mapping at the rim;
      // the copied read below adds the filtering border. The layer test
      // control retains the old conservative bounds for pixel comparison.
      const radius = dabs[dab + SMUDGE.RADIUS]
      let reachX = radius * Math.SQRT2
      let reachY = reachX
      if (stroke.lays && !stroke.source && context.wetTarget !== "layer") {
        const angle = dabs[dab + SMUDGE.ANGLE] * Math.PI * 2
        const cosine = Math.abs(Math.cos(angle))
        const sine = Math.abs(Math.sin(angle))
        const roundness = dabs[dab + SMUDGE.ROUNDNESS]
        reachX = radius * (cosine + roundness * sine) + 1
        reachY = radius * (sine + roundness * cosine) + 1
      }
      const left = Math.max(clipLeft, Math.floor(x - reachX))
      const top = Math.max(clipTop, Math.floor(y - reachY))
      const right = Math.min(clipRight, Math.ceil(x + reachX))
      const bottom = Math.min(clipBottom, Math.ceil(y + reachY))
      const writes = right > left && bottom > top && (drags || flow > 0)
      if (!writes && !picksUp) continue
      // Wet pickup reads the full tip, including outside selections. Smudge
      // also needs the pixels one travel behind. A texel borders the blend.
      const fromLeft = Math.max(
        0,
        Math.floor(
          stroke.lays ? x - radius * Math.SQRT2 : Math.min(left, left - travelX)
        ) - 1
      )
      const fromTop = Math.max(
        0,
        Math.floor(
          stroke.lays ? y - radius * Math.SQRT2 : Math.min(top, top - travelY)
        ) - 1
      )
      const fromRight = Math.min(
        width,
        Math.ceil(
          stroke.lays
            ? x + radius * Math.SQRT2
            : Math.max(right, right - travelX)
        ) + 1
      )
      const fromBottom = Math.min(
        height,
        Math.ceil(
          stroke.lays
            ? y + radius * Math.SQRT2
            : Math.max(bottom, bottom - travelY)
        ) + 1
      )
      if (fromRight <= fromLeft || fromBottom <= fromTop) continue
      const span = Math.max(fromRight - fromLeft, fromBottom - fromTop)
      if (span > MAX_CARRY_SIZE) continue
      // Submitted ahead of this frame's dabs, so none has written there yet.
      stroke.source?.reach(fromLeft, fromTop, fromRight, fromBottom)
      const instance = drawn * SMUDGE_INSTANCE_STRIDE
      drawnDabs.set(dabs.subarray(dab, dab + SMUDGE_STRIDE), instance)
      drawnDabs[instance + SMUDGE.FLOW] = flow
      drawnDabs[instance + SMUDGE.TRAVEL_X] = travelX
      drawnDabs[instance + SMUDGE.TRAVEL_Y] = travelY
      drawnDabs[instance + SMUDGE.ORIGIN_X] = fromLeft
      drawnDabs[instance + SMUDGE.ORIGIN_Y] = fromTop
      const rect = drawn * DAB_RECT_STRIDE
      rects[rect + DAB_RECT.READ_LEFT] = fromLeft
      rects[rect + DAB_RECT.READ_TOP] = fromTop
      rects[rect + DAB_RECT.READ_WIDTH] = fromRight - fromLeft
      rects[rect + DAB_RECT.READ_HEIGHT] = fromBottom - fromTop
      rects[rect + DAB_RECT.WRITE_LEFT] = left
      rects[rect + DAB_RECT.WRITE_TOP] = top
      rects[rect + DAB_RECT.WRITE_WIDTH] = writes ? right - left : 0
      rects[rect + DAB_RECT.WRITE_HEIGHT] = writes ? bottom - top : 0
      if (writes) {
        stroke.reached.left = Math.min(stroke.reached.left, left)
        stroke.reached.top = Math.min(stroke.reached.top, top)
        stroke.reached.right = Math.max(stroke.reached.right, right)
        stroke.reached.bottom = Math.max(stroke.reached.bottom, bottom)
        stroke.target.empty = false
      }
      drawn++
    }
    if (drawn === 0) return
    const tip = context.tip()
    params[0] = width
    params[1] = height
    params[2] = tip.feather
    params[3] = tip.usesTip ? 1 : 0
    params[4] = selection ? 1 : 0
    params[5] = stroke.lays ? 1 : 0
    params[6] = reservoirExtent / reservoirSize
    const grain = context.grain()
    params[7] = grain.scale
    params[8] = grain.depth
    params[9] = grain.movement
    const localTarget =
      stroke.lays && !stroke.source && context.wetTarget !== "layer"
    params[10] = localTarget ? 1 : 0
    params[11] = context.legacyPickup ? 0 : 1
    let targetSpan = 64
    if (localTarget)
      for (let dab = 0; dab < drawn; dab++) {
        const rect = dab * DAB_RECT_STRIDE
        targetSpan = Math.max(
          targetSpan,
          rects[rect + DAB_RECT.READ_WIDTH],
          rects[rect + DAB_RECT.READ_HEIGHT]
        )
        const instance = dab * SMUDGE_INSTANCE_STRIDE
        drawnDabs[instance + SMUDGE.ORIGIN_X] = rects[rect + DAB_RECT.READ_LEFT]
        drawnDabs[instance + SMUDGE.ORIGIN_Y] = rects[rect + DAB_RECT.READ_TOP]
      }
    const targetLevel = localTarget
      ? Math.floor(Math.log2(MAX_CARRY_SIZE / targetSpan))
      : 0
    device.queue.writeBuffer(uniform, 0, params)
    device.queue.writeBuffer(
      instances,
      0,
      drawnDabs,
      0,
      drawn * SMUDGE_INSTANCE_STRIDE
    )
    // Kept between frames of a stroke, which must allocate nothing (D30).
    if (
      !bindGroup ||
      reservoirBindings.length === 0 ||
      wetDabTarget !== stroke.target.texture
    ) {
      wetDabTarget = stroke.target.texture
      const entries: GPUBindGroupEntry[] = [
        { binding: 0, resource: { buffer: uniform } },
        { binding: 1, resource: tip.sampler },
        {
          binding: 2,
          resource: tip.texture.createView({ dimension: "2d-array" }),
        },
        { binding: 3, resource: carrySampler },
        { binding: 4, resource: carry.createView() },
        {
          binding: 5,
          resource: (selection?.texture ?? context.noSelection).createView(),
        },
      ]
      entries.push(
        { binding: 6, resource: grain.sampler },
        { binding: 7, resource: grain.texture.createView() }
      )
      reservoirBindings = reservoirViews.map((resource) => ({
        layer: device.createBindGroup({
          layout: pipeline.getBindGroupLayout(0),
          entries: [
            ...entries,
            { binding: 8, resource },
            {
              binding: 9,
              resource: stroke.source ? destinationView : carry.createView(),
            },
          ],
        }),
        pickup: device.createBindGroup({
          layout: reservoirPipeline.getBindGroupLayout(0),
          entries: [...entries.slice(0, 5), { binding: 8, resource }],
        }),
      }))
      wetDabBindings = [false, true].map((direct) =>
        destinationViews.map((destination) =>
          reservoirViews.map((resource, reads) =>
            device.createBindGroup({
              layout: wetDabLayout,
              entries: [
                ...entries.slice(0, 4),
                {
                  binding: 4,
                  resource: direct ? stroke.target.view : carry.createView(),
                },
                entries[5],
                { binding: 8, resource },
                { binding: 10, resource: reservoirViews[1 - reads] },
                { binding: 11, resource: { buffer: runUniform, size: 64 } },
                { binding: 12, resource: destination },
              ],
            })
          )
        )
      )
      bindGroup = reservoirBindings[0].layer
      runBindings = runTextures.map((texture, reads) =>
        device.createBindGroup({
          layout: runLayout,
          entries: [
            {
              binding: 0,
              resource: { buffer: runUniform, size: RUN_DAB_BYTES },
            },
            entries[1],
            entries[2],
            entries[3],
            { binding: 4, resource: texture.createView() },
            {
              binding: 5,
              resource: (stroke.source ? carry : texture).createView(),
            },
            { binding: 6, resource: entries[5].resource },
            { binding: 7, resource: runTextures[1 - reads].createView() },
          ],
        })
      )
    }
    // Each dab reads what the one before it wrote. Dabs that drag share a
    // pass a run at a time; any other is a copy and a pass of its own. One
    // encoder holds the frame's worth in order.
    const encoder = device.createCommandEncoder()
    let anyRun = false
    let anyWetCompute = false
    let wetLeft = 0
    let wetTop = 0
    let wetWidth = 0
    let wetHeight = 0
    for (let i = 0; i < drawn; i++) {
      const runEnd = stroke.lays
        ? i
        : dabRunEnd(rects, i, drawn, runLimit, runRegion)
      if (runEnd > i) {
        drawRun(encoder, i, runEnd)
        anyRun = true
        // The loop steps on from the run's last dab.
        i = runEnd - 1
        continue
      }
      const rect = i * DAB_RECT_STRIDE
      const instance = i * SMUDGE_INSTANCE_STRIDE
      const radius = drawnDabs[instance + SMUDGE.RADIUS]
      const aligned =
        localTarget &&
        !context.legacyPickup &&
        !tip.usesTip &&
        grain.depth === 0 &&
        drawnDabs[instance + SMUDGE.STRENGTH] > 0 &&
        drawnDabs[instance + SMUDGE.ANGLE] === 0 &&
        drawnDabs[instance + SMUDGE.ROUNDNESS] === 1 &&
        radius * 2 === reservoirExtent &&
        (reservoirExtent & (reservoirExtent - 1)) === 0
      const directRead =
        aligned &&
        context.wetTarget !== "scratch" &&
        (width & (width - 1)) === 0 &&
        (height & (height - 1)) === 0
      if (localTarget) {
        wetLeft = rects[rect + DAB_RECT.READ_LEFT]
        wetTop = rects[rect + DAB_RECT.READ_TOP]
        wetWidth = rects[rect + DAB_RECT.READ_WIDTH]
        wetHeight = rects[rect + DAB_RECT.READ_HEIGHT]
        keepTiles(encoder, i)
        if (!directRead)
          encoder.copyTextureToTexture(
            {
              texture: stroke.target.texture,
              origin: { x: wetLeft, y: wetTop },
            },
            { texture: carry },
            [wetWidth, wetHeight]
          )
      } else {
        keepTiles(encoder, i)
        stroke.source?.copy(
          encoder,
          rects[rect + DAB_RECT.READ_LEFT],
          rects[rect + DAB_RECT.READ_TOP],
          rects[rect + DAB_RECT.READ_WIDTH],
          rects[rect + DAB_RECT.READ_HEIGHT],
          carry
        )
        encoder.copyTextureToTexture(
          {
            texture: stroke.target.texture,
            origin: {
              x: rects[rect + DAB_RECT.READ_LEFT],
              y: rects[rect + DAB_RECT.READ_TOP],
            },
          },
          { texture: stroke.source ? destinationCarry : carry },
          {
            width: rects[rect + DAB_RECT.READ_WIDTH],
            height: rects[rect + DAB_RECT.READ_HEIGHT],
          }
        )
      }
      if (aligned) {
        prepareWetDab(i, directRead)
        const pickup = encoder.beginComputePass({ label: "wet dab" })
        pickup.setPipeline(wetDabPipeline)
        pickup.setBindGroup(
          0,
          wetDabBindings[directRead ? 1 : 0][targetLevel][reservoirIndex],
          runOffsets,
          i,
          1
        )
        if (
          rects[rect + DAB_RECT.WRITE_WIDTH] > 0 &&
          rects[rect + DAB_RECT.WRITE_HEIGHT] > 0
        )
          pickup.dispatchWorkgroups(
            Math.ceil(rects[rect + DAB_RECT.WRITE_WIDTH] / 16),
            Math.ceil(rects[rect + DAB_RECT.WRITE_HEIGHT] / 8)
          )
        pickup.setPipeline(wetPickupPipeline)
        pickup.dispatchWorkgroups(
          Math.ceil(reservoirExtent / 16),
          Math.ceil(reservoirExtent / 8)
        )
        pickup.end()
        anyWetCompute = true
      }
      if (
        !aligned &&
        rects[rect + DAB_RECT.WRITE_WIDTH] > 0 &&
        rects[rect + DAB_RECT.WRITE_HEIGHT] > 0
      ) {
        const pass = encoder.beginRenderPass({
          colorAttachments: [
            {
              view: localTarget
                ? destinationViews[targetLevel]
                : stroke.target.view,
              loadOp: "load",
              storeOp: "store",
            },
          ],
        })
        pass.setPipeline(pipeline)
        pass.setBindGroup(
          0,
          stroke.lays ? reservoirBindings[reservoirIndex].layer : bindGroup
        )
        pass.setVertexBuffer(0, instances)
        if (localTarget) pass.setViewport(0, 0, wetWidth, wetHeight, 0, 1)
        pass.setScissorRect(
          rects[rect + DAB_RECT.WRITE_LEFT] - (localTarget ? wetLeft : 0),
          rects[rect + DAB_RECT.WRITE_TOP] - (localTarget ? wetTop : 0),
          rects[rect + DAB_RECT.WRITE_WIDTH],
          rects[rect + DAB_RECT.WRITE_HEIGHT]
        )
        pass.draw(6, 1, 0, i)
        pass.end()
      }
      if (
        stroke.lays &&
        drawnDabs[i * SMUDGE_INSTANCE_STRIDE + SMUDGE.STRENGTH] > 0
      ) {
        const next = 1 - reservoirIndex
        if (!aligned) {
          const pickup = encoder.beginRenderPass({
            colorAttachments: [
              {
                view: reservoirViews[next],
                loadOp: "load",
                storeOp: "store",
              },
            ],
          })
          pickup.setViewport(0, 0, reservoirExtent, reservoirExtent, 0, 1)
          pickup.setPipeline(reservoirPipeline)
          pickup.setBindGroup(0, reservoirBindings[reservoirIndex].pickup)
          pickup.setVertexBuffer(0, instances)
          pickup.draw(6, 1, 0, i)
          pickup.end()
        }
        dirty = true
        reservoirIndex = next
      }
      if (
        localTarget &&
        rects[rect + DAB_RECT.WRITE_WIDTH] > 0 &&
        rects[rect + DAB_RECT.WRITE_HEIGHT] > 0
      ) {
        const x = rects[rect + DAB_RECT.WRITE_LEFT]
        const y = rects[rect + DAB_RECT.WRITE_TOP]
        encoder.copyTextureToTexture(
          {
            texture: destinationCarry,
            mipLevel: targetLevel,
            origin: { x: x - wetLeft, y: y - wetTop },
          },
          { texture: stroke.target.texture, origin: { x, y } },
          [
            rects[rect + DAB_RECT.WRITE_WIDTH],
            rects[rect + DAB_RECT.WRITE_HEIGHT],
          ]
        )
      }
    }
    if (anyRun || anyWetCompute)
      device.queue.writeBuffer(
        runUniform,
        0,
        runParams,
        0,
        drawn * RUN_DAB_FLOATS
      )
    device.queue.submit([encoder.finish()])
  }

  /**
   * Before a dab writes: any tile under it that no dab has yet touched is
   * kept as it is.
   */
  function prepareWetDab(dab: number, directRead: boolean) {
    const instance = dab * SMUDGE_INSTANCE_STRIDE
    const rect = dab * DAB_RECT_STRIDE
    runParams.set(
      [
        drawnDabs[instance + SMUDGE.CENTER_X],
        drawnDabs[instance + SMUDGE.CENTER_Y],
        drawnDabs[instance + SMUDGE.RADIUS],
        drawnDabs[instance + SMUDGE.STRENGTH],
        drawnDabs[instance + SMUDGE.ORIGIN_X],
        drawnDabs[instance + SMUDGE.ORIGIN_Y],
        0,
        drawnDabs[instance + SMUDGE.FLOW],
        rects[rect + DAB_RECT.WRITE_WIDTH],
        rects[rect + DAB_RECT.WRITE_HEIGHT],
        reservoirExtent,
        directRead ? 1 : 0,
        rects[rect + DAB_RECT.WRITE_LEFT] - rects[rect + DAB_RECT.READ_LEFT],
        rects[rect + DAB_RECT.WRITE_TOP] - rects[rect + DAB_RECT.READ_TOP],
        0,
        0,
      ],
      dab * RUN_DAB_FLOATS
    )
  }

  function keepTiles(encoder: GPUCommandEncoder, dab: number) {
    const stroke = session!
    const rect = dab * DAB_RECT_STRIDE
    const left = rects[rect + DAB_RECT.WRITE_LEFT]
    const top = rects[rect + DAB_RECT.WRITE_TOP]
    const width = rects[rect + DAB_RECT.WRITE_WIDTH]
    const height = rects[rect + DAB_RECT.WRITE_HEIGHT]
    if (width <= 0 || height <= 0) return
    const tilesAcross = Math.ceil(context.size().width / TILE_SIZE)
    const lastColumn = (left + width - 1) >> TILE_SHIFT
    const lastRow = (top + height - 1) >> TILE_SHIFT
    for (let row = top >> TILE_SHIFT; row <= lastRow; row++) {
      for (let column = left >> TILE_SHIFT; column <= lastColumn;) {
        const tile = row * tilesAcross + column
        if (stroke.kept.has(tile)) {
          column++
          continue
        }
        const slot = stroke.kept.size
        let count = 0
        // One copy for adjacent new tiles in both the document row and the
        // backup row. Never cross a kept tile, backup row or document edge.
        const room = BACKUP_PAGE_TILES - (slot % BACKUP_PAGE_TILES)
        while (
          column <= lastColumn &&
          count < room &&
          !stroke.kept.has(row * tilesAcross + column)
        ) {
          stroke.kept.set(row * tilesAcross + column, slot + count)
          column++
          count++
        }
        copyBackupTile(encoder, stroke.target, tile, slot, "keep", count)
      }
    }
  }

  /**
   * Draws a run of dragging dabs, `from` up to `to`, in one pass (live
   * brushes 22): the region `runRegion` names is copied out of the surface,
   * each dab reads it as the dab before left it and writes it on, and what
   * the last wrote is copied back. Two copies and a pass for the run, where
   * its dabs drawn alone are a copy and a pass each.
   */
  function drawRun(encoder: GPUCommandEncoder, from: number, to: number) {
    const stroke = session!
    const left = runRegion[0]
    const top = runRegion[1]
    const width = runRegion[2]
    const height = runRegion[3]
    const extent = { width, height }
    const inSurface = {
      texture: stroke.target.texture,
      origin: { x: left, y: top },
    }
    for (let dab = from; dab < to; dab++) {
      keepTiles(encoder, dab)
      const instance = dab * SMUDGE_INSTANCE_STRIDE
      const rect = dab * DAB_RECT_STRIDE
      const block = dab * RUN_DAB_FLOATS
      runParams[block + RUN_DAB.VIEWPORT_X] = params[0]
      runParams[block + RUN_DAB.VIEWPORT_Y] = params[1]
      runParams[block + RUN_DAB.FEATHER] = params[2]
      runParams[block + RUN_DAB.USE_TIP] = params[3]
      runParams[block + RUN_DAB.USE_SELECTION] = params[4]
      runParams[block + RUN_DAB.CENTER_X] =
        drawnDabs[instance + SMUDGE.CENTER_X]
      runParams[block + RUN_DAB.CENTER_Y] =
        drawnDabs[instance + SMUDGE.CENTER_Y]
      runParams[block + RUN_DAB.TRAVEL_X] =
        drawnDabs[instance + SMUDGE.TRAVEL_X]
      runParams[block + RUN_DAB.TRAVEL_Y] =
        drawnDabs[instance + SMUDGE.TRAVEL_Y]
      runParams[block + RUN_DAB.RADIUS] = drawnDabs[instance + SMUDGE.RADIUS]
      runParams[block + RUN_DAB.STRENGTH] =
        drawnDabs[instance + SMUDGE.STRENGTH]
      runParams[block + RUN_DAB.ANGLE] = drawnDabs[instance + SMUDGE.ANGLE]
      runParams[block + RUN_DAB.ROUNDNESS] =
        drawnDabs[instance + SMUDGE.ROUNDNESS]
      runParams[block + RUN_DAB.TIP_FRAME] =
        drawnDabs[instance + SMUDGE.TIP_FRAME]
      runParams[block + RUN_DAB.REGION_X] = left
      runParams[block + RUN_DAB.REGION_Y] = top
      runParams[block + RUN_DAB.REGION_WIDTH] = width
      runParams[block + RUN_DAB.REGION_HEIGHT] = height
      const clipLeft = rects[rect + DAB_RECT.WRITE_LEFT]
      const clipTop = rects[rect + DAB_RECT.WRITE_TOP]
      runParams[block + RUN_DAB.CLIP_LEFT] = clipLeft
      runParams[block + RUN_DAB.CLIP_TOP] = clipTop
      runParams[block + RUN_DAB.CLIP_RIGHT] =
        clipLeft + rects[rect + DAB_RECT.WRITE_WIDTH]
      runParams[block + RUN_DAB.CLIP_BOTTOM] =
        clipTop + rects[rect + DAB_RECT.WRITE_HEIGHT]
    }
    if (stroke.source) {
      // The region's corners are no dab's, so they are reached here.
      stroke.source.reach(left, top, left + width, top + height)
      stroke.source.copy(encoder, left, top, width, height, carry)
    }
    encoder.copyTextureToTexture(inSurface, { texture: runTextures[0] }, extent)
    const pass = encoder.beginComputePass()
    pass.setPipeline(runPipeline)
    const across = Math.ceil(width / RUN_WORKGROUP)
    const down = Math.ceil(height / RUN_WORKGROUP)
    for (let dab = from; dab < to; dab++) {
      pass.setBindGroup(0, runBindings[(dab - from) & 1], runOffsets, dab, 1)
      pass.dispatchWorkgroups(across, down)
    }
    pass.end()
    encoder.copyTextureToTexture(
      { texture: runTextures[(to - from) & 1] },
      inSurface,
      extent
    )
  }

  /**
   * Copies one tile between a surface and its slot in the backup: out of the
   * surface to keep it, or back into the surface to restore it. An edge tile
   * is copied as far as the canvas goes.
   */
  function copyBackupTile(
    encoder: GPUCommandEncoder,
    surface: Surface,
    tile: number,
    slot: number,
    direction: "keep" | "restore",
    count = 1
  ) {
    const { width, height } = context.size()
    const page = Math.floor(slot / BACKUP_PAGE_SLOTS)
    // The one allocation a stroke may make as it goes, once in as many tiles
    // as a page holds: the alternative is paying for the document at pen-down.
    while (backupPages.length <= page) backupPages.push(createBackupPage())
    const tilesAcross = Math.ceil(width / TILE_SIZE)
    const x = (tile % tilesAcross) * TILE_SIZE
    const y = Math.floor(tile / tilesAcross) * TILE_SIZE
    const slotInPage = slot % BACKUP_PAGE_SLOTS
    const inSurface = { texture: surface.texture, origin: { x, y } }
    const inBackup = {
      texture: backupPages[page],
      origin: {
        x: (slotInPage % BACKUP_PAGE_TILES) * TILE_SIZE,
        y: Math.floor(slotInPage / BACKUP_PAGE_TILES) * TILE_SIZE,
      },
    }
    encoder.copyTextureToTexture(
      direction === "keep" ? inSurface : inBackup,
      direction === "keep" ? inBackup : inSurface,
      {
        width: Math.min(TILE_SIZE * count, width - x),
        height: Math.min(TILE_SIZE, height - y),
      }
    )
  }

  function createBackupPage() {
    return device.createTexture({
      label: "smudge backup",
      size: [BACKUP_PAGE_TILES * TILE_SIZE, BACKUP_PAGE_TILES * TILE_SIZE],
      format: LAYER_FORMAT,
      usage: GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST,
    })
  }

  /** Gives back the pages a long stroke needed, past those kept. */
  function trimBackup(kept = BACKUP_PAGES_KEPT) {
    while (backupPages.length > kept) backupPages.pop()!.destroy()
  }

  function end(keep: boolean): StrokeMark | null {
    if (!session) return null
    const {
      target,
      source,
      reached,
      kept,
      wasEmpty,
      lays,
      retain,
      beforeDirty,
      beforeExtent,
    } = session
    session = undefined
    source?.release()
    if (lays) {
      if (!keep && beforeDirty) {
        const encoder = device.createCommandEncoder()
        for (const texture of reservoirs)
          encoder.copyTextureToTexture(
            { texture: reservoirBackup },
            { texture },
            [beforeExtent, beforeExtent]
          )
        device.queue.submit([encoder.finish()])
        dirty = beforeDirty
        reservoirExtent = beforeExtent
        reservoirIndex = 0
      } else if (!keep || !retain) clearReservoir()
    }
    const region =
      reached.right > reached.left && reached.bottom > reached.top
        ? {
            x: reached.left,
            y: reached.top,
            width: reached.right - reached.left,
            height: reached.bottom - reached.top,
          }
        : null
    if (!keep && kept.size > 0) {
      // Only the tiles a dab wrote to: the rest never changed.
      const encoder = device.createCommandEncoder()
      for (const [tile, slot] of kept)
        copyBackupTile(encoder, target, tile, slot, "restore")
      device.queue.submit([encoder.finish()])
      target.empty = wasEmpty
    }
    trimBackup()
    if (!keep || !region) return null
    // The tiles kept for a cancel are the tiles a dab wrote to, which is
    // what history has to read back (live brushes 30).
    const tilesAcross = Math.ceil(context.size().width / TILE_SIZE)
    const tiles = [...kept.keys()]
      .sort((a, b) => a - b)
      .map((tile) => ({
        x: tile % tilesAcross,
        y: Math.floor(tile / tilesAcross),
      }))
    return { region, tiles }
  }

  return {
    /**
     * Nothing is copied yet: each tile is kept as it is when a dab first
     * writes to it. A stroke can open on an empty destination when it lays
     * colour or has visible artwork to sample.
     */
    begin({ target, lay, retain = false, source }) {
      if (target.empty && !lay && (!source || source.empty)) {
        source?.release()
        return false
      }
      if (session) end(false)
      if (!!source !== samplesArtwork) {
        bindGroup = undefined
        reservoirBindings = []
        samplesArtwork = !!source
      }
      const beforeDirty = dirty
      const beforeExtent = reservoirExtent
      if (lay) {
        if (dirty) {
          const encoder = device.createCommandEncoder()
          encoder.copyTextureToTexture(
            { texture: reservoirs[reservoirIndex] },
            { texture: reservoirBackup },
            [reservoirExtent, reservoirExtent]
          )
          device.queue.submit([encoder.finish()])
        }
        if (!retain || !dirty) clearReservoir(lay)
      }
      session = {
        target,
        source,
        lays: !!lay,
        load: !retain || !beforeDirty ? lay : null,
        retain,
        beforeDirty,
        beforeExtent,
        wasEmpty: target.empty,
        last: null,
        reached: {
          left: Infinity,
          top: Infinity,
          right: -Infinity,
          bottom: -Infinity,
        },
        kept: new Map(),
      }
      return true
    },
    /**
     * Dabs are laid out as `SMUDGE` says. The first smudge dab has nothing
     * behind it; the first wet dab exchanges paint with the clean load.
     */
    draw(dabs, count) {
      if (!session || count <= 0) return
      if (count > MAX_SMUDGE_DABS_PER_DRAW)
        throw new Error("Too many smudge dabs for one draw.")
      drawDabs(dabs, count)
    },
    end,
    cleanBrush: () => clearReservoir(),
    brushDirty: () => dirty,
    prepareSampling() {
      if (samplingPrepared) return
      // Creating a texture alone leaves its first GPU use on the first dab.
      // A full copy initializes the carry without touching a retained load.
      const blank = device.createTexture({
        label: "sampled carry initialization",
        size: [MAX_CARRY_SIZE, MAX_CARRY_SIZE],
        format: LAYER_FORMAT,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      })
      const encoder = device.createCommandEncoder()
      encoder
        .beginRenderPass({
          colorAttachments: [
            {
              view: blank.createView(),
              loadOp: "clear",
              storeOp: "store",
              clearValue: { r: 0, g: 0, b: 0, a: 0 },
            },
          ],
        })
        .end()
      encoder.copyTextureToTexture(
        { texture: blank },
        { texture: destinationCarry },
        [MAX_CARRY_SIZE, MAX_CARRY_SIZE]
      )
      device.queue.submit([encoder.finish()])
      blank.destroy()
      samplingPrepared = true
    },
    warm(encoder) {
      for (const view of [...destinationViews, ...reservoirViews])
        encoder
          .beginRenderPass({
            colorAttachments: [{ view, loadOp: "load", storeOp: "store" }],
          })
          .end()
    },
    invalidateBinding() {
      bindGroup = undefined
      reservoirBindings = []
    },
    drop(surface) {
      if (surface && session?.target !== surface) return
      if (session) end(false)
      session = undefined
      if (surface) return
      clearReservoir()
      // The document is going: its strokes' pages go with it, but the first.
      trimBackup(1)
    },
    destroy() {
      session?.source?.release()
      session = undefined
      for (const page of backupPages.splice(0)) page.destroy()
      loadUniform.destroy()
      for (const texture of reservoirs) texture.destroy()
      reservoirBackup.destroy()
      carry.destroy()
      destinationCarry.destroy()
      bindGroup = undefined
      runBindings = []
      for (const texture of runTextures) texture.destroy()
      runUniform.destroy()
      uniform.destroy()
      instances.destroy()
    },
  }
}
