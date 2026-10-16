import {
  intersectRect,
  tileBounds,
  tileIndexForPixel,
  TILE_SIZE,
  type TileCoord,
} from "../doc/tile-grid"
import type { BrushBlot } from "../brush/brush"
import { boardDown, isFlat, type Board } from "../doc/board"
import type { WetCopy } from "../doc/undo-stack"
import {
  FLUID_DAMP_STEPS,
  FLUID_HOLDS,
  FLUID_MAX_WATER,
  FLUID_RELIEF,
  FLUID_SLOT_HELD,
  fluidDabShader,
  fluidSettleShader,
  fluidSimShader,
} from "../shaders/fluid"
import { STAMP, STAMP_STRIDE } from "./stamp-instance"
import type { StrokeMark, StrokeRenderer } from "./stroke-renderer"
import { LAYER_FORMAT, type Surface } from "./surface"
import {
  createWetTiles,
  WET_CELL_SIZE,
  WET_CELLS,
  WET_SLOTS,
  type WetTiles,
  type WetTilesState,
} from "./wet-tiles"

/** Slots along a row of a field texture; see `wet.wgsl`. */
const FIELD_COLUMNS = 8
/**
 * A field texture's size in cells: rows enough for every slot and no more,
 * so the wet tile limit is the whole of what the fields are allocated for.
 */
const FIELD_WIDTH = FIELD_COLUMNS * WET_CELLS
const FIELD_HEIGHT = Math.ceil(WET_SLOTS / FIELD_COLUMNS) * WET_CELLS

/**
 * What a batch of dabs lays its water and dampness into, with the share of
 * the brush's water its dabs carry in alpha.
 */
const LAID_WATER_FORMAT: GPUTextureFormat = LAYER_FORMAT

/**
 * One dab in one wet tile, as the dab pass takes it: the centre and radius
 * in cells of the field texture, the pigment it carries and its slot's box,
 * then its turn, squash, share of water, tip frame and colour offsets.
 */
const INSTANCE_STRIDE = 16

/**
 * Instances drawn in one pass. A dab is one for each tile it reaches, which
 * is one or two for all but the largest; past this the batch is drawn in
 * more passes than one, never in a larger buffer (D30).
 */
const MAX_INSTANCES_PER_DRAW = 4096

/**
 * Water a cell loses in a step, from a brush's `drying`: a wash laid at
 * half `water` is gone in five thousand steps at zero and a hundred at one.
 */
const evaporation = (drying: number) => 0.0002 * 50 ** drying

/**
 * The most of its pigment a cell trades with one neighbour in a step. With a
 * fifth of its water leaving by each of four faces as well, a cell still
 * gives away no more pigment than it has.
 */
const MAX_BLEED = 0.05

/**
 * How many times faster water evaporates at the very edge of the damp area
 * than in the middle of it, less one, at a brush's full `edge`. Looked at
 * and left (fluid brushes 12): at half `edge` the rim is a dark band and
 * not a line, and at full it leaves the middle of a wash pale.
 */
const MAX_EDGE = 12

/**
 * How much faster the paper takes pigment in its deepest valley than at its
 * middle height, less one, at a brush's full `granulation`. Tuned by eye
 * (fluid brushes 12): much past this the paper's coarsest grain takes the
 * wash over in blotches, and leaves too little afloat to gather at the rim.
 */
const MAX_GRANULATION = 6

/** Steps a body is kept past when its water and dampness should be gone. */
const DRYING_MARGIN = 20

/**
 * How far the paper drops over a cell straight downhill on the steepest
 * board (fluid brushes 38, 39), in depth of water: a wash levels to a surface
 * that much deeper a cell further down. At 0.1 a flooded 48 px wash travels
 * over 8 document px in 400 steps; below HOLDS it still only slopes. The
 * steepness curve remains for tuning with a pen (31).
 */
const STEEPEST_FALL = 0.1

/**
 * Bytes of the simulation's uniform: its rates and the brush's water, the
 * board, then a row for each slot.
 */
const SIM_LEVEL_OFFSET = 16
const SIM_FALL_OFFSET = 32
const SIM_TILES_OFFSET = 48
const SIM_UNIFORM_SIZE = SIM_TILES_OFFSET + WET_SLOTS * 16

/** What a fluid stroke is told as it opens. */
export type FluidOpening = {
  /** The layer whose wet surface the stroke paints into. */
  surface: Surface
  /** Premultiplied linear ink. */
  ink: readonly [number, number, number, number]
  /** How much of the ink a dab at full flow carries, in [0, 1]. */
  load: number
  /** How much water a dab carries, in [0, 1]. */
  water: number
  /** How fast the paint dries, in [0, 1]. */
  drying: number
  /** How far pigment spreads into paint that is still wet, in [0, 1]. */
  bleed: number
  /** How much faster the edge of a wash dries than its middle, in [0, 1]. */
  edge: number
  /** How much pigment settles into the paper's valleys, in [0, 1]. */
  granulation: number
  /**
   * Present, the stroke is a blot (fluid brushes 17): its dabs lay nothing
   * and take water and suspended pigment out of the wet surface, `load` being
   * how strongly a dab takes at full flow. The five settings above are then
   * not read: a blot leaves the wet surface's rates as they were.
   */
  blot?: BrushBlot
}

/** What the fluid stroke reads of, and asks of, the renderer it draws for. */
export type FluidStrokeContext = {
  /** The document's size in pixels. */
  size(): { width: number; height: number }
  /** The brush's rim falloff, in document pixels. */
  feather(): number
  /** The brush's tip: its texture, and whether that is the dab's shape. */
  tip(): { texture: GPUTexture; sampler: GPUSampler; usesTip: boolean }
  /** The paper every fluid brush paints on, a texel a document pixel. */
  paper(): GPUTextureView
  /**
   * The selection's coverage, a texel a document pixel, or nothing with
   * none selected. `selectionChanged` says when this is another texture.
   */
  selection(): GPUTextureView | undefined
  /** A layer became wet or dry: whatever shows it has to bind it again. */
  wetChanged(): void
  /**
   * The wet layer's paint is in the fields' other copy now, as after every
   * pass of the simulation: what shows it reads `wet` again.
   */
  wetMoved(): void
}

/**
 * What shows wet paint reads: each tile's slot, the two pigment fields, and
 * the selection that holds the paint in.
 */
export type WetViews = {
  /** Which copy of the fields these are of, from one. */
  key: number
  slots: GPUTextureView
  deposited: GPUTextureView
  suspended: GPUTextureView
  /** The selection's coverage, or a texel of full coverage with none. */
  selection: GPUTextureView
}

/**
 * The fluid stroke, and the wet surface it paints into: the two are one
 * module, since the stroke is what makes paint wet and the surface is where
 * it stays so after the pen lifts.
 */
export interface FluidStroke extends StrokeRenderer<FluidOpening> {
  /**
   * Draws `count` dabs of the stroke in flight. One that needs a wet tile
   * with every slot taken settles a body early to make room; answers what
   * each such settle wrote, in order.
   */
  draw(dabs: Float32Array, count: number): readonly StrokeMark[]
  /**
   * What the compositor shows over a layer's pixels: the wet tiles' slots
   * and their pigment, or nothing unless `surface` is the one that is wet.
   */
  wet(surface: Surface): WetViews | undefined
  /** Whether any tile is wet. */
  isWet(): boolean
  /** Whether the tile under a document pixel of `surface` is wet. */
  wetAt(surface: Surface, x: number, y: number): boolean
  /**
   * How many tiles a step runs over: those wet, less those held while
   * drying is paused.
   */
  tileCount(): number
  /**
   * Runs the simulation on by `steps` steps, fewer if everything dries or
   * holds first. A body whose deadline passes settles into the layer, or
   * with drying paused holds; answers what each settle wrote, in order.
   */
  advance(steps: number): StrokeMark[] | Promise<StrokeMark[]>
  /**
   * Pauses drying, or lets it go on (fluid brushes 18). Paused, nothing
   * evaporates, and a body whose deadline passes holds, its water standing
   * and no longer stepped, until a dab lands in it. Let go, every body dries
   * from where it is.
   */
  setPaused(paused: boolean): void
  /**
   * The board the paper lies on (fluid brushes 38): wet paint runs down it
   * from the next step, whatever is wet now included.
   */
  setBoard(board: Board): void
  /**
   * The copy of the water field the next step reads, for the renderer's
   * test readback of it (fluid brushes 38); null before any fluid brush.
   */
  waterField(): GPUTexture | null
  /**
   * Settles everything wet into the layer at once and frees it. Answers what
   * that wrote, or null with nothing wet.
   */
  dry(): StrokeMark | null
  /**
   * Allocates the wet fields, ahead of the pen going down (D30). A stroke
   * that finds them missing allocates them as it opens.
   */
  prepare(): void
  /**
   * Lets go of everything wet without settling it: the layer it is on has
   * gone. With a surface, only if that is the one that is wet.
   */
  drop(surface?: Surface): void
  /**
   * The copy of the wet fields the stroke last ended took at pen-down, handed
   * over once and the taker's to release: what undoing that stroke restores.
   * Null where the stroke was cancelled or laid nothing.
   */
  takeCopy(): WetCopy | null
  /**
   * Copies the wet fields of every wet tile as they now are, GPU to GPU:
   * nothing is read back (D30).
   */
  copy(): WetCopy
  /**
   * Makes a copy the wet fields again, on `surface`, and the simulation
   * carries on from there. The copy is still its holder's.
   */
  restore(copy: WetCopy, surface: Surface): void
  /** Frees a copy. */
  release(copy: WetCopy): void
  /**
   * The selection is another texture, or none: whatever reads it binds it
   * again. What it covers changing is not this, and is read as it is.
   */
  selectionChanged(): void
  destroy(): void
}

/** The wet fields, in the order a kept copy's layers hold them. */
const FIELD_NAMES = ["water", "suspended", "deposited"] as const

/** One copy of the wet fields; a step reads one and writes the other. */
type Fields = Record<
  (typeof FIELD_NAMES)[number],
  { texture: GPUTexture; view: GPUTextureView }
>

/**
 * The wet fields as they were at one moment: the cells of every tile that
 * was wet, side by side in a texture of their own with a layer for each
 * field, and what was known of those tiles off the GPU.
 */
type KeptFields = WetCopy & {
  /** The cells; none with nothing wet. */
  texture?: GPUTexture
  /** The slot each tile's cells were copied out of, in the order kept. */
  slots: number[]
  tiles: WetTilesState
  /** The grid the tiles were on: a copy does not outlive a resize. */
  grid: object
  reached: Float64Array
  flooded: Uint8Array
  clock: number
  rates: [number, number, number, number]
  lifetime: number
  /** Whether drying was paused, so the deadlines kept are hold timers. */
  paused: boolean
}

/**
 * The third stroke renderer (D42, §6.2): a fluid brush's dabs lay water and
 * pigment into the wet surface of the active layer, and no tile changes
 * while the pen is down or when it lifts. The wet surface is sparse wet
 * tiles on the document's tile grid, each a slot in the field textures at
 * half resolution, shown inside the layer by the glaze function.
 *
 * The paint stays wet and moves, a step of the simulation at a time, until
 * its body's deadline passes or it is told to dry. Then it settles: the
 * same glaze function writes it into the layer's own pixels, and its slots
 * are freed.
 */
export function createFluidStroke(
  device: GPUDevice,
  context: FluidStrokeContext
): FluidStroke {
  const uniform = device.createBuffer({
    size: 48,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  /**
   * The stroke's pipelines, compiled when a brush is first made fluid and
   * not with the renderer: a session that never paints fluid pays nothing
   * for them.
   */
  function compile() {
    const add: GPUBlendState = {
      color: { srcFactor: "one", dstFactor: "one" },
      alpha: { srcFactor: "one", dstFactor: "one" },
    }
    // Water and dampness add up; the share of the brush's water is the
    // deepest any dab of the batch carries there.
    const addWater: GPUBlendState = {
      color: add.color,
      alpha: { operation: "max", srcFactor: "one", dstFactor: "one" },
    }
    const dabModule = device.createShaderModule({ code: fluidDabShader })
    const dabBuffers: GPUVertexBufferLayout[] = [
      {
        arrayStride: INSTANCE_STRIDE * 4,
        stepMode: "instance",
        attributes: [
          { shaderLocation: 0, offset: 0, format: "float32x2" },
          { shaderLocation: 1, offset: 8, format: "float32" },
          { shaderLocation: 2, offset: 12, format: "float32" },
          { shaderLocation: 3, offset: 16, format: "float32x4" },
          { shaderLocation: 4, offset: 32, format: "float32" },
          { shaderLocation: 5, offset: 36, format: "float32" },
          { shaderLocation: 6, offset: 40, format: "float32" },
          { shaderLocation: 7, offset: 44, format: "float32" },
          { shaderLocation: 8, offset: 48, format: "float32x3" },
        ],
      },
    ]
    // Said outright rather than left to the pipeline, so that one binding
    // serves a paint dab and a blot one.
    const dabBindings = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: {},
        },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        {
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { viewDimension: "2d-array" },
        },
      ],
    })
    const dabLayout = device.createPipelineLayout({
      bindGroupLayouts: [dabBindings],
    })
    const dabPipeline = device.createRenderPipeline({
      label: "fluid dabs",
      layout: dabLayout,
      vertex: {
        module: dabModule,
        entryPoint: "vertexMain",
        buffers: dabBuffers,
      },
      fragment: {
        module: dabModule,
        entryPoint: "fragmentMain",
        targets: [
          { format: LAID_WATER_FORMAT, blend: addWater },
          { format: LAYER_FORMAT, blend: add },
        ],
      },
      primitive: { topology: "triangle-strip" },
    })
    // A blot's dabs keep, in the pigment target, the product of what each
    // leaves of a cell: cleared to one, and each multiplying it by one less
    // its own strength.
    const keep: GPUBlendComponent = {
      srcFactor: "zero",
      dstFactor: "one-minus-src",
    }
    const blotPipeline = device.createRenderPipeline({
      label: "fluid blot dabs",
      layout: dabLayout,
      vertex: {
        module: dabModule,
        entryPoint: "vertexMain",
        buffers: dabBuffers,
      },
      fragment: {
        module: dabModule,
        entryPoint: "blotFragment",
        targets: [
          { format: LAID_WATER_FORMAT, writeMask: 0 },
          { format: LAYER_FORMAT, blend: { color: keep, alpha: keep } },
        ],
      },
      primitive: { topology: "triangle-strip" },
    })
    const settleModule = device.createShaderModule({ code: fluidSettleShader })
    const settlePipeline = device.createRenderPipeline({
      label: "fluid settle",
      layout: "auto",
      vertex: { module: settleModule, entryPoint: "vertexMain" },
      fragment: {
        module: settleModule,
        entryPoint: "fragmentMain",
        targets: [{ format: LAYER_FORMAT }],
      },
      primitive: { topology: "triangle-list" },
    })

    // One layout for the step and the pour, so one binding serves both; each
    // leaves some of it unread.
    const read = (binding: number): GPUBindGroupLayoutEntry => ({
      binding,
      visibility: GPUShaderStage.COMPUTE,
      texture: {},
    })
    const write = (binding: number): GPUBindGroupLayoutEntry => ({
      binding,
      visibility: GPUShaderStage.COMPUTE,
      storageTexture: { format: LAYER_FORMAT },
    })
    const simLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: {} },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          texture: { sampleType: "uint" },
        },
        read(2),
        read(3),
        read(4),
        write(5),
        write(6),
        write(7),
        read(8),
        read(9),
        read(10),
        read(11),
        { binding: 12, visibility: GPUShaderStage.COMPUTE, sampler: {} },
        {
          binding: 13,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "storage" },
        },
      ],
    })
    const simModule = device.createShaderModule({ code: fluidSimShader })
    const simPipeline = (entryPoint: string) =>
      device.createComputePipeline({
        label: `fluid ${entryPoint}`,
        layout: device.createPipelineLayout({ bindGroupLayouts: [simLayout] }),
        compute: { module: simModule, entryPoint },
      })
    return {
      dab: dabPipeline,
      blot: blotPipeline,
      dabBindings,
      settle: settlePipeline,
      simLayout,
      step: simPipeline("stepMain"),
      pour: simPipeline("pourMain"),
      absorb: simPipeline("blotMain"),
    }
  }
  let pipelines: ReturnType<typeof compile> | undefined

  const instances = new Float32Array(MAX_INSTANCES_PER_DRAW * INSTANCE_STRIDE)
  const instanceBuffer = device.createBuffer({
    size: instances.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  })
  const simUniform = device.createBuffer({
    size: SIM_UNIFORM_SIZE,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const runEdges = device.createBuffer({
    label: "fluid run edges",
    size: WET_SLOTS * 4,
    usage:
      GPUBufferUsage.STORAGE |
      GPUBufferUsage.COPY_SRC |
      GPUBufferUsage.COPY_DST,
  })
  const edgeReadback = device.createBuffer({
    label: "fluid run edge readback",
    size: WET_SLOTS * 4,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  })
  const edgeMasks = new Uint32Array(WET_SLOTS)
  const reportedTiles: (TileCoord | undefined)[] = Array.from({
    length: WET_SLOTS,
  })
  const faces = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const
  // An awaited report must not claim tiles after undo, a new dab, a board
  // change or disposal has replaced what the GPU saw.
  let revision = 0
  let advancing = false
  const simData = new ArrayBuffer(SIM_UNIFORM_SIZE)
  const simRates = new Float32Array(simData, 0, 4)
  /** The depth of water the brush in hand fills a cell to. */
  const simLevel = new Float32Array(simData, SIM_LEVEL_OFFSET, 1)
  /** What a blot brush takes: the share of water, then of pigment. */
  const simBlot = new Float32Array(simData, SIM_LEVEL_OFFSET + 4, 2)
  /** The board: how hard water is pulled downhill, then which way is down. */
  const simFall = new Float32Array(simData, SIM_FALL_OFFSET, 3)
  const simTiles = new Int32Array(simData, SIM_TILES_OFFSET)

  const uniformValues = new Float32Array(12)
  /** The dab pass's binding, and the tip texture it was made over. */
  let dabBinding: GPUBindGroup | undefined
  let boundTip: GPUTexture | undefined
  /** How far past its radius a dab may lay: a turned tip's corners carry ink. */
  let tipReach = 1

  /** The brush's tip is replaced as the brush is: the binding follows it. */
  function bindDabs() {
    const tip = context.tip()
    if (dabBinding && boundTip === tip.texture) return dabBinding
    boundTip = tip.texture
    dabBinding = device.createBindGroup({
      layout: pipelines!.dabBindings,
      entries: [
        { binding: 0, resource: { buffer: uniform } },
        { binding: 1, resource: tip.sampler },
        {
          binding: 2,
          resource: tip.texture.createView({ dimension: "2d-array" }),
        },
      ],
    })
    return dabBinding
  }

  /**
   * Read in the selection's place while nothing is selected: one texel of
   * full coverage, which is what every read of it finds wherever it looks.
   */
  const unselected = device.createTexture({
    size: { width: 1, height: 1 },
    format: "r8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  })
  device.queue.writeTexture(
    { texture: unselected },
    new Uint8Array([255]),
    {},
    { width: 1, height: 1 }
  )
  const unselectedView = unselected.createView()
  const selectionView = () => context.selection() ?? unselectedView
  /** A cell's coverage is the mean of its pixels': a filtered read. */
  const selectionSampler = device.createSampler({
    magFilter: "linear",
    minFilter: "linear",
  })

  /**
   * The wet fields, a slot per wet tile, held from the first fluid brush
   * on: two copies of the water, the pigment suspended in it and the pigment
   * the paper has taken, each premultiplied by its density.
   */
  let fields:
    | {
        copies: [Fields, Fields]
        /** What one batch of dabs laid, before it is poured in. */
        laidWater: GPUTextureView
        laidPigment: GPUTextureView
        /** One tile of a layer, copied for settle to read. */
        under: GPUTexture
        /** A slot of nothing, copied over a slot as it is freed. */
        blank: GPUTexture
        textures: GPUTexture[]
      }
    | undefined
  /** Which copy of the fields holds the paint as it now is. */
  let current = 0
  /** Each tile's slot, as the shaders read it; the size of the tile grid. */
  let slots: { texture: GPUTexture; view: GPUTextureView } | undefined
  let tiles: WetTiles | undefined
  let grid = { columns: 0, rows: 0 }
  // Made as they are first needed, one for each copy of the fields.
  let shown: (WetViews | undefined)[] = []
  let settleBindings: (GPUBindGroup | undefined)[] = []
  let simBindings: (GPUBindGroup | undefined)[] = []
  /** One past the last slot held: as far as the simulation is dispatched. */
  let span = 0

  /** The layer that is wet, while any tile of it is. */
  let surface: Surface | undefined
  /** The layer the stroke in flight paints. */
  let painting: Surface | undefined
  /**
   * The wet fields as the stroke in flight found them, and whether it has
   * laid anything on them since: what a cancel restores, and what the stroke
   * hands history when it is kept.
   */
  let penDown: KeptFields | undefined
  let laid = false
  /** Whether the stroke in flight is a blot's, which lays nothing. */
  let blotting = false
  /** The last kept stroke's pen-down copy, until it is taken. */
  let handover: KeptFields | undefined
  /** Every copy not yet released. */
  const copies = new Set<KeptFields>()
  let load = 1
  /** Steps run since the fields were made: what deadlines are counted in. */
  let clock = 0
  /** Steps a body outlives its last dab by, at the brush's drying. */
  let lifetime = 0
  /**
   * Whether drying is paused (fluid brushes 18): nothing evaporates, and a
   * body whose deadline passes holds, its water still standing.
   */
  let paused = false
  /**
   * The slots of held bodies, by slot: alike in both copies of the fields,
   * so a step that passes them by leaves them as they are whichever copy is
   * current. Kept, as is what `hold` finds, so a step allocates none (D30).
   */
  const holding = new Uint8Array(WET_SLOTS)
  const holdingNow = new Uint8Array(WET_SLOTS)
  let heldCount = 0

  // What the dabs laid into each slot reached, in document pixels: settling
  // tells history the box round a mark, not the tiles it lies in.
  const reached = new Float64Array(WET_SLOTS * 4)
  /**
   * The slots of bodies a brush has laid more water into than the paper
   * holds: their paint may have bloomed past what the dabs reached, into any
   * of their tiles.
   */
  const flooded = new Uint8Array(WET_SLOTS)
  /** Whether the stroke in flight lays that much water. */
  let flooding = false
  /** The slots a frame's dabs landed in; kept, so a frame allocates none. */
  const touched = new Set<number>()
  const noMarks: readonly StrokeMark[] = []

  /** Pushes back the drying of every body the frame's dabs landed in. */
  function refreshTouched() {
    for (const slot of touched) {
      const tile = tiles!.tile(slot)!
      tiles!.refresh(tile.x, tile.y, clock + lifetime)
    }
    // A held body painted into moves again.
    hold()
  }

  /** A slot with no tile: no dab has reached it, and no water flooded it. */
  function forget(slot: number) {
    reached[slot * 4] = Infinity
    reached[slot * 4 + 1] = Infinity
    reached[slot * 4 + 2] = -Infinity
    reached[slot * 4 + 3] = -Infinity
    flooded[slot] = 0
  }
  for (let slot = 0; slot < WET_SLOTS; slot++) forget(slot)

  function field(usage: number, format = LAYER_FORMAT) {
    const texture = device.createTexture({
      size: { width: FIELD_WIDTH, height: FIELD_HEIGHT },
      format,
      usage: GPUTextureUsage.TEXTURE_BINDING | usage,
    })
    return { texture, view: texture.createView() }
  }

  function prepare() {
    const { width, height } = context.size()
    const columns = Math.ceil(width / TILE_SIZE)
    const rows = Math.ceil(height / TILE_SIZE)
    pipelines ??= compile()
    if (!fields) {
      // A step writes a copy whole, a freed slot is copied over, and undo
      // copies the wet slots out and back.
      const simulated =
        GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.COPY_SRC
      const copy = (): Fields => ({
        water: field(simulated),
        suspended: field(simulated),
        deposited: field(simulated),
      })
      const copies: [Fields, Fields] = [copy(), copy()]
      const laidWater = field(
        GPUTextureUsage.RENDER_ATTACHMENT,
        LAID_WATER_FORMAT
      )
      const laidPigment = field(GPUTextureUsage.RENDER_ATTACHMENT)
      const under = device.createTexture({
        size: { width: TILE_SIZE, height: TILE_SIZE },
        format: LAYER_FORMAT,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      })
      const blank = device.createTexture({
        size: { width: WET_CELLS, height: WET_CELLS },
        format: LAYER_FORMAT,
        usage: GPUTextureUsage.COPY_SRC,
      })
      fields = {
        copies,
        laidWater: laidWater.view,
        laidPigment: laidPigment.view,
        under,
        blank,
        textures: [
          ...copies.flatMap((fields) =>
            Object.values(fields).map((field) => field.texture)
          ),
          laidWater.texture,
          laidPigment.texture,
          under,
          blank,
        ],
      }
    }
    if (slots && grid.columns === columns && grid.rows === rows) return
    // The document was resized: nothing wet outlives its grid.
    slots?.texture.destroy()
    grid = { columns, rows }
    const texture = device.createTexture({
      size: { width: columns, height: rows },
      format: "r8uint",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    })
    slots = { texture, view: texture.createView() }
    tiles = createWetTiles(columns, rows)
    for (let slot = 0; slot < WET_SLOTS; slot++) forget(slot)
    holding.fill(0)
    heldCount = 0
    span = 0
    shown = []
    settleBindings = []
    simBindings = []
  }

  /** Steps for water so deep to be gone, and the paper dry after it. */
  const outlasting = (water: number) =>
    Math.ceil(water / simRates[0]) + FLUID_DAMP_STEPS + DRYING_MARGIN

  /**
   * Gives every body the time the deepest water takes to dry at the current
   * rate: what paint already wet is owed when it will dry more slowly than
   * its deadline was counted for.
   */
  function outlastDeepest() {
    for (const slot of tiles!.slots()) {
      const tile = tiles!.tile(slot)!
      tiles!.refresh(tile.x, tile.y, clock + outlasting(FLUID_MAX_WATER))
    }
  }

  /**
   * Tells the simulation its rates and slots. Paused, it is told nothing
   * evaporates; `simRates` keeps the rate drying goes on at.
   */
  function writeSim() {
    const rate = simRates[0]
    if (paused) simRates[0] = 0
    device.queue.writeBuffer(simUniform, 0, simData)
    simRates[0] = rate
  }

  /** Tells the shaders which tiles hold which slots. */
  function writeSlots() {
    revision++
    device.queue.writeTexture(
      { texture: slots!.texture },
      tiles!.map(),
      { bytesPerRow: grid.columns },
      { width: grid.columns, height: grid.rows }
    )
    simTiles.fill(0)
    span = 0
    for (const slot of tiles!.slots()) {
      const tile = tiles!.tile(slot)!
      simTiles[slot * 4] = tile.x
      simTiles[slot * 4 + 1] = tile.y
      simTiles[slot * 4 + 2] = 1
      span = slot + 1
    }
    // Held again from what the deadlines say, below.
    holding.fill(0)
    heldCount = 0
    writeSim()
    hold()
  }

  /**
   * With drying paused, holds every body whose deadline has passed and lets
   * go of any a dab has pushed back, telling the step which is which: it
   * passes a held slot by. A slot newly held is copied into the other copy
   * of the fields, so that both hold it as it now is.
   */
  function hold() {
    if (!paused || !tiles) return
    const count = tiles.due(clock, holdingNow)
    let changed = false
    let encoder: GPUCommandEncoder | undefined
    for (let slot = 0; slot < WET_SLOTS; slot++) {
      if (holdingNow[slot] === holding[slot]) continue
      changed = true
      simTiles[slot * 4 + 2] = holdingNow[slot] ? FLUID_SLOT_HELD : 1
      if (holdingNow[slot])
        copyAcross((encoder ??= device.createCommandEncoder()), slot)
    }
    if (encoder) device.queue.submit([encoder.finish()])
    holding.set(holdingNow)
    heldCount = count
    if (changed) writeSim()
  }

  /** Copies a slot of the current copy of the fields into the other. */
  function copyAcross(encoder: GPUCommandEncoder, slot: number) {
    const from = fields!.copies[current]
    const to = fields!.copies[1 - current]
    for (const name of FIELD_NAMES)
      encoder.copyTextureToTexture(
        { texture: from[name].texture, origin: slotOrigin(slot) },
        { texture: to[name].texture, origin: slotOrigin(slot) },
        SLOT_EXTENT
      )
  }

  /** One pass of the simulation, out of the current copy into the other. */
  function simulate(encoder: GPUCommandEncoder, pipeline: GPUComputePipeline) {
    const from = fields!.copies[current]
    const to = fields!.copies[1 - current]
    simBindings[current] ??= device.createBindGroup({
      layout: pipelines!.simLayout,
      entries: [
        { binding: 0, resource: { buffer: simUniform } },
        { binding: 1, resource: slots!.view },
        { binding: 2, resource: from.water.view },
        { binding: 3, resource: from.suspended.view },
        { binding: 4, resource: from.deposited.view },
        { binding: 5, resource: to.water.view },
        { binding: 6, resource: to.suspended.view },
        { binding: 7, resource: to.deposited.view },
        { binding: 8, resource: fields!.laidWater },
        { binding: 9, resource: fields!.laidPigment },
        { binding: 10, resource: context.paper() },
        { binding: 11, resource: selectionView() },
        { binding: 12, resource: selectionSampler },
        { binding: 13, resource: { buffer: runEdges } },
      ],
    })
    const pass = encoder.beginComputePass()
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, simBindings[current])
    pass.dispatchWorkgroups(WET_CELLS / 8, WET_CELLS / 8, span)
    pass.end()
    current = 1 - current
    // A pour or a blot writes held slots too (a blot leaves them held), and
    // into one copy: the other is brought level.
    if (heldCount > 0 && pipeline !== pipelines!.step)
      for (let slot = 0; slot < WET_SLOTS; slot++)
        if (holding[slot]) copyAcross(encoder, slot)
  }

  /** Where the `index`th slot's cells are in a texture of slots in rows. */
  const slotOrigin = (index: number) => ({
    x: (index % FIELD_COLUMNS) * WET_CELLS,
    y: Math.floor(index / FIELD_COLUMNS) * WET_CELLS,
  })
  const SLOT_EXTENT = { width: WET_CELLS, height: WET_CELLS }

  /**
   * Empties slots in both copies of the fields, so the next tile to take
   * one starts dry whichever copy is current by then.
   */
  function blank(encoder: GPUCommandEncoder, emptied: readonly number[]) {
    for (const slot of emptied)
      for (const copy of fields!.copies)
        for (const field of Object.values(copy))
          encoder.copyTextureToTexture(
            { texture: fields!.blank },
            { texture: field.texture, origin: slotOrigin(slot) },
            SLOT_EXTENT
          )
  }

  /** Frees slots and empties them. */
  function free(freed: readonly number[]) {
    const encoder = device.createCommandEncoder()
    blank(encoder, freed)
    for (const slot of freed) {
      tiles!.release(slot)
      forget(slot)
    }
    device.queue.submit([encoder.finish()])
    writeSlots()
    if (tiles!.count() === 0) surface = undefined
  }

  /**
   * Copies the wet fields of every wet tile, GPU to GPU, with what is known
   * of those tiles off it. Only the wet slots are kept, so a copy costs what
   * the wash it is of does.
   */
  function keepFields(): KeptFields {
    prepare()
    const held = tiles!.slots()
    const size = {
      width: Math.min(held.length, FIELD_COLUMNS) * WET_CELLS,
      height: Math.ceil(held.length / FIELD_COLUMNS) * WET_CELLS,
    }
    const kept: KeptFields = {
      // Half floats, four to a cell, in each of the fields.
      bytes: size.width * size.height * FIELD_NAMES.length * 8,
      slots: held,
      tiles: tiles!.save(),
      grid,
      reached: reached.slice(),
      flooded: flooded.slice(),
      clock,
      paused,
      rates: [simRates[0], simRates[1], simRates[2], simRates[3]],
      lifetime,
    }
    copies.add(kept)
    if (held.length === 0) return kept
    const texture = device.createTexture({
      size: { ...size, depthOrArrayLayers: FIELD_NAMES.length },
      format: LAYER_FORMAT,
      usage: GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST,
    })
    kept.texture = texture
    const from = fields!.copies[current]
    const encoder = device.createCommandEncoder()
    held.forEach((slot, index) =>
      FIELD_NAMES.forEach((name, layer) =>
        encoder.copyTextureToTexture(
          { texture: from[name].texture, origin: slotOrigin(slot) },
          { texture, origin: { ...slotOrigin(index), z: layer } },
          SLOT_EXTENT
        )
      )
    )
    device.queue.submit([encoder.finish()])
    return kept
  }

  function release(kept: KeptFields | undefined) {
    if (!kept || !copies.delete(kept)) return
    kept.texture?.destroy()
  }

  /**
   * Makes a kept copy the wet fields again, on `onto`: the tiles that were
   * wet then are wet now, in the slots they had, and every other is dry.
   */
  function putBack(kept: KeptFields, onto: Surface) {
    // Released, or of a grid the document no longer has: nothing to put back.
    if (!copies.has(kept) || kept.grid !== grid || !tiles) return
    const stays = new Set(kept.slots)
    const encoder = device.createCommandEncoder()
    blank(
      encoder,
      tiles.slots().filter((slot) => !stays.has(slot))
    )
    // Into the current copy alone: a pass writes the other whole wherever a
    // slot is held.
    const to = fields!.copies[current]
    kept.slots.forEach((slot, index) =>
      FIELD_NAMES.forEach((name, layer) =>
        encoder.copyTextureToTexture(
          {
            texture: kept.texture!,
            origin: { ...slotOrigin(index), z: layer },
          },
          { texture: to[name].texture, origin: slotOrigin(slot) },
          SLOT_EXTENT
        )
      )
    )
    device.queue.submit([encoder.finish()])
    tiles.restore(kept.tiles)
    reached.set(kept.reached)
    flooded.set(kept.flooded)
    clock = kept.clock
    simRates.set(kept.rates)
    lifetime = kept.lifetime
    // Kept while drying was paused, nothing in it has evaporated since its
    // deadlines were set: drying going on gives it the time, as it gave the
    // paint it replaces.
    if (kept.paused && !paused) outlastDeepest()
    // The rates go with the slots.
    writeSlots()
    surface = kept.slots.length > 0 ? onto : undefined
    context.wetChanged()
  }

  /** Lets go of everything wet, unsettled. */
  function discard() {
    if (!tiles || tiles.count() === 0) {
      surface = undefined
      return
    }
    free(tiles.slots())
    context.wetChanged()
  }

  /**
   * Puts the dab at `offset` of `dabs` into the instance list, as it lands
   * in one wet tile and that tile's slot.
   */
  function place(
    dabs: Float32Array,
    offset: number,
    column: number,
    row: number,
    slot: number,
    at: number
  ) {
    const slotX = (slot % FIELD_COLUMNS) * WET_CELLS
    const slotY = Math.floor(slot / FIELD_COLUMNS) * WET_CELLS
    instances[at] =
      dabs[offset + STAMP.CENTER_X] / WET_CELL_SIZE - column * WET_CELLS + slotX
    instances[at + 1] =
      dabs[offset + STAMP.CENTER_Y] / WET_CELL_SIZE - row * WET_CELLS + slotY
    instances[at + 2] = dabs[offset + STAMP.RADIUS] / WET_CELL_SIZE
    instances[at + 3] = dabs[offset + STAMP.OPACITY] * load
    instances[at + 4] = slotX
    instances[at + 5] = slotY
    instances[at + 6] = slotX + WET_CELLS
    instances[at + 7] = slotY + WET_CELLS
    instances[at + 8] = dabs[offset + STAMP.ANGLE]
    instances[at + 9] = dabs[offset + STAMP.ROUNDNESS]
    instances[at + 10] = dabs[offset + STAMP.WATER]
    instances[at + 11] = dabs[offset + STAMP.TIP_FRAME]
    instances[at + 12] = dabs[offset + STAMP.HUE]
    instances[at + 13] = dabs[offset + STAMP.SATURATION]
    instances[at + 14] = dabs[offset + STAMP.LIGHTNESS]
  }

  /**
   * A blot's dabs (fluid brushes 17): each tile they reach that is wet has
   * water and pigment taken out of it, and one that is dry is passed over.
   * None is given a slot, so none makes another body settle, and no body's
   * drying is pushed back.
   */
  function blot(dabs: Float32Array, count: number) {
    if (surface !== painting) return noMarks
    touched.clear()
    let filled = 0
    for (let i = 0; i < count; i++) {
      const offset = i * STAMP_STRIDE
      const x = dabs[offset + STAMP.CENTER_X]
      const y = dabs[offset + STAMP.CENTER_Y]
      const reach = dabs[offset + STAMP.RADIUS] * tipReach + WET_CELL_SIZE
      const lastColumn = tileIndexForPixel(x + reach)
      const lastRow = tileIndexForPixel(y + reach)
      for (let row = tileIndexForPixel(y - reach); row <= lastRow; row++)
        for (
          let column = tileIndexForPixel(x - reach);
          column <= lastColumn;
          column++
        ) {
          const slot = tiles!.slotAt(column, row)
          if (slot < 0) continue
          touched.add(slot)
          if (filled === MAX_INSTANCES_PER_DRAW) {
            drawInstances(filled)
            filled = 0
          }
          place(dabs, offset, column, row, slot, filled++ * INSTANCE_STRIDE)
        }
    }
    drawInstances(filled)
    if (touched.size === 0) return noMarks
    laid = true
    context.wetMoved()
    return noMarks
  }

  function drawInstances(count: number) {
    if (count === 0) return
    device.queue.writeBuffer(
      instanceBuffer,
      0,
      instances,
      0,
      count * INSTANCE_STRIDE
    )
    const encoder = device.createCommandEncoder()
    const pass = encoder.beginRenderPass({
      // Only this batch: what the last one laid has been poured in.
      // A blot's batch keeps what it leaves of each cell, from all of it.
      colorAttachments: [fields!.laidWater, fields!.laidPigment].map(
        (view, target) => ({
          view,
          clearValue:
            blotting && target === 1
              ? { r: 1, g: 1, b: 1, a: 1 }
              : { r: 0, g: 0, b: 0, a: 0 },
          loadOp: "clear" as const,
          storeOp: "store" as const,
        })
      ),
    })
    pass.setPipeline(blotting ? pipelines!.blot : pipelines!.dab)
    pass.setBindGroup(0, bindDabs())
    pass.setVertexBuffer(0, instanceBuffer)
    pass.draw(4, count)
    pass.end()
    simulate(encoder, blotting ? pipelines!.absorb : pipelines!.pour)
    device.queue.submit([encoder.finish()])
  }

  /**
   * Which of the slots settling are in a body a brush has flooded, by slot.
   * Bodies settle whole, so the tiles of one are those that touch among the
   * slots given.
   */
  function floodedBodies(settling: readonly number[]) {
    const within = new Uint8Array(WET_SLOTS)
    const settlingAt = new Map<string, number>()
    for (const slot of settling) {
      const tile = tiles!.tile(slot)!
      settlingAt.set(`${tile.x},${tile.y}`, slot)
    }
    const reach = settling.filter((slot) => flooded[slot] === 1)
    for (const slot of reach) within[slot] = 1
    while (reach.length > 0) {
      const tile = tiles!.tile(reach.pop()!)!
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const next = settlingAt.get(`${tile.x + dx},${tile.y + dy}`)
          if (next === undefined || within[next]) continue
          within[next] = 1
          reach.push(next)
        }
    }
    return within
  }

  /**
   * Glazes the wet paint in `settling` onto the layer, a tile at a time, and
   * frees those slots. They are whole bodies, so no tile is settled beside
   * one still wet. Answers what was written, or null when none of it is on
   * the canvas.
   */
  function settle(settling: readonly number[]): StrokeMark | null {
    const target = surface
    if (!target || settling.length === 0) return null
    const { width, height } = context.size()
    const canvas = { x: 0, y: 0, width, height }
    const views = fields!.copies[current]
    settleBindings[current] ??= device.createBindGroup({
      layout: pipelines!.settle.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: fields!.under.createView() },
        { binding: 1, resource: slots!.view },
        { binding: 2, resource: views.deposited.view },
        { binding: 3, resource: views.suspended.view },
        { binding: 4, resource: context.paper() },
        { binding: 5, resource: selectionView() },
      ],
    })
    const box = {
      left: Infinity,
      top: Infinity,
      right: -Infinity,
      bottom: -Infinity,
    }
    const written: TileCoord[] = []
    // Bodies settle whole, so a slot of one that was flooded says its paint
    // may lie anywhere in the tiles settling: the box is theirs.
    const anywhere = floodedBodies(settling)
    const encoder = device.createCommandEncoder()
    for (const slot of settling) {
      const tile = tiles!.tile(slot)!
      // Edge tiles hang past the canvas; only what is on it is settled.
      const visible = intersectRect(tileBounds(tile), canvas)
      if (!visible) continue
      // A tile of the ring that no water could have bloomed into is as dry
      // as it was taken: there is nothing in it to settle.
      if (!anywhere[slot] && reached[slot * 4] === Infinity) continue
      written.push(tile)
      if (anywhere[slot]) {
        box.left = Math.min(box.left, visible.x)
        box.top = Math.min(box.top, visible.y)
        box.right = Math.max(box.right, visible.x + visible.width)
        box.bottom = Math.max(box.bottom, visible.y + visible.height)
      } else {
        box.left = Math.min(box.left, reached[slot * 4])
        box.top = Math.min(box.top, reached[slot * 4 + 1])
        box.right = Math.max(box.right, reached[slot * 4 + 2])
        box.bottom = Math.max(box.bottom, reached[slot * 4 + 3])
      }
      // A pass cannot read the layer it draws into, so the tile is copied
      // out first and glazed back from the copy.
      encoder.copyTextureToTexture(
        { texture: target.texture, origin: { x: visible.x, y: visible.y } },
        { texture: fields!.under },
        { width: visible.width, height: visible.height }
      )
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          { view: target.view, loadOp: "load", storeOp: "store" },
        ],
      })
      pass.setPipeline(pipelines!.settle)
      pass.setBindGroup(0, settleBindings[current])
      pass.setScissorRect(visible.x, visible.y, visible.width, visible.height)
      pass.draw(3)
      pass.end()
    }
    // Submitted before the slots are freed: the queue writes the slots map
    // at once, and the passes above still have to find these tiles in it.
    device.queue.submit([encoder.finish()])
    free(settling)
    context.wetChanged()
    // The stroke in flight's copy holds paint that is in the layer now, and
    // restoring it would lay that paint twice: the stroke starts over from
    // what is left wet.
    if (penDown) {
      release(penDown)
      penDown = keepFields()
      laid = false
    }

    const x = Math.max(0, Math.floor(box.left))
    const y = Math.max(0, Math.floor(box.top))
    const right = Math.min(width, Math.ceil(box.right))
    const bottom = Math.min(height, Math.ceil(box.bottom))
    if (written.length === 0 || right <= x || bottom <= y) return null
    target.empty = false
    written.sort((a, b) => a.y - b.y || a.x - b.x)
    return {
      region: { x, y, width: right - x, height: bottom - y },
      tiles: written,
    }
  }

  /** No report is needed where every downhill face already has a slot, or
   * ends at the document boundary. This is topology, not a guess at water.
   */
  function needsEdges() {
    if (simFall[0] <= 0) return false
    for (let slot = 0; slot < span; slot++) {
      const tile = tiles!.tile(slot)
      if (!tile || holding[slot]) continue
      for (const [dx, dy] of faces) {
        if (dx * simFall[1] + dy * simFall[2] <= 0) continue
        const x = tile.x + dx
        const y = tile.y + dy
        if (x < 0 || y < 0 || x >= grid.columns || y >= grid.rows) continue
        if (tiles!.slotAt(x, y) < 0) return true
      }
    }
    return false
  }

  /** A tilted step reports flooded faces; only the driver can acquire slots.
   * Awaiting the 256-byte report yields to input, never blocks presentation.
   * At most one step is in flight, so no water crosses an unclaimed face.
   */
  async function advanceRuns(steps: number): Promise<StrokeMark[]> {
    const marks: StrokeMark[] = []
    if (advancing) return marks
    advancing = true
    let stepped = false
    try {
      for (let i = 0; i < steps && tiles!.count() > heldCount; i++) {
        const before = revision
        for (let slot = 0; slot < WET_SLOTS; slot++)
          reportedTiles[slot] = tiles!.tile(slot)
        const encoder = device.createCommandEncoder()
        encoder.clearBuffer(runEdges)
        simulate(encoder, pipelines!.step)
        encoder.copyBufferToBuffer(runEdges, 0, edgeReadback, 0, WET_SLOTS * 4)
        device.queue.submit([encoder.finish()])
        clock++
        stepped = true
        await edgeReadback.mapAsync(GPUMapMode.READ)
        edgeMasks.set(new Uint32Array(edgeReadback.getMappedRange()))
        edgeReadback.unmap()
        if (revision !== before) break
        if (paused) hold()
        else {
          const mark = settle(tiles!.expired(clock))
          if (mark) marks.push(mark)
        }
        let fresh = false
        for (let source = 0; source < WET_SLOTS; source++) {
          const tile = reportedTiles[source]
          if (!tile || tiles!.tile(source) !== tile || holding[source]) continue
          for (let face = 0; face < faces.length; face++) {
            if (!(edgeMasks[source] & (1 << face))) continue
            const [dx, dy] = faces[face]
            const x = tile.x + dx
            const y = tile.y + dy
            if (tiles!.slotAt(x, y) >= 0) continue
            // Do not use a source slot's report after an earlier claim made
            // its body settle, even if that slot has since been reused.
            if (tiles!.tile(source) !== tile) break
            const crowding = tiles!.crowding(
              x,
              y,
              undefined,
              paused ? clock : undefined,
              source
            )
            if (crowding.length > 0) {
              if (fresh) writeSlots()
              fresh = false
              const mark = settle(crowding)
              if (mark) marks.push(mark)
              if (tiles!.tile(source) !== tile) break
            }
            const next = tiles!.extend(source, dx, dy)
            if (next < 0) continue
            flooded[source] = flooded[next] = 1
            fresh = true
          }
        }
        if (fresh) writeSlots()
      }
    } finally {
      advancing = false
      if (stepped) context.wetMoved()
    }
    return marks
  }

  return {
    wet(of) {
      if (!surface || of !== surface) return undefined
      const views = fields!.copies[current]
      return (shown[current] ??= {
        key: current + 1,
        slots: slots!.view,
        deposited: views.deposited.view,
        suspended: views.suspended.view,
        selection: selectionView(),
      })
    },
    isWet: () => !!tiles && tiles.count() > 0,
    wetAt: (of, x, y) =>
      !!tiles &&
      of === surface &&
      tiles.slotAt(tileIndexForPixel(x), tileIndexForPixel(y)) >= 0,
    tileCount: () => (tiles?.count() ?? 0) - heldCount,
    prepare,
    begin(opening) {
      revision++
      if (context.size().width === 0)
        throw new Error("The render target has not been sized.")
      if (
        !Number.isFinite(opening.load) ||
        opening.load < 0 ||
        opening.load > 1
      )
        throw new Error("A fluid dab's load must be a finite value in [0, 1].")
      prepare()
      // One layer is wet at a time: whoever opens a stroke on another has
      // dried this one first. A blot dries nothing, and on another layer
      // finds nothing wet to take from.
      if (surface && surface !== opening.surface && !opening.blot)
        throw new Error("Another layer is still wet.")
      painting = opening.surface
      blotting = !!opening.blot
      // Before the brush's rates are put to the wash: they are undone too.
      // A blot with nothing of its layer wet has nothing to put back.
      release(penDown)
      penDown =
        blotting && surface !== opening.surface ? undefined : keepFields()
      laid = false
      load = opening.load
      uniformValues.set(opening.ink)
      uniformValues[4] = FIELD_WIDTH
      uniformValues[5] = FIELD_HEIGHT
      uniformValues[6] = context.feather() / WET_CELL_SIZE
      uniformValues[7] = opening.water
      const usesTip = context.tip().usesTip
      uniformValues[8] = usesTip ? 1 : 0
      tipReach = usesTip ? Math.SQRT2 : 1
      device.queue.writeBuffer(uniform, 0, uniformValues)
      // A blot leaves the rates, the depth and every deadline as they were.
      if (opening.blot) {
        simBlot[0] = opening.blot.water
        simBlot[1] = opening.blot.pigment
        writeSim()
        return true
      }
      // The whole wet surface runs at the rates of the brush last put to it.
      const slower = evaporation(opening.drying) < simRates[0]
      simRates[0] = evaporation(opening.drying)
      simRates[1] = MAX_BLEED * opening.bleed
      simRates[2] = MAX_EDGE * opening.edge
      simRates[3] = MAX_GRANULATION * opening.granulation
      simLevel[0] = opening.water
      const depth = opening.water * FLUID_MAX_WATER
      flooding = depth > FLUID_HOLDS
      writeSim()
      // The brush fills a cell no deeper than its own water, and levelling
      // raises it by no more than the paper's relief is worth.
      lifetime = outlasting(Math.min(depth + FLUID_RELIEF, FLUID_MAX_WATER))
      // Paint already wet dries more slowly from here on, so it is given
      // the time, as for the deepest water there may be: a deadline is not
      // to pass with water still standing. Paused, nothing evaporates, and
      // drying going on again gives every body that time.
      if (slower && !paused) outlastDeepest()
      return true
    },
    /** Dabs are laid out as `STAMP` says. */
    draw(dabs, count) {
      if (!painting || count <= 0) return noMarks
      revision++
      if (blotting) return blot(dabs, count)
      touched.clear()
      let marks: StrokeMark[] | undefined
      let filled = 0
      /** Slots taken since the shaders were last told of them. */
      let fresh = 0
      for (let i = 0; i < count; i++) {
        const offset = i * STAMP_STRIDE
        const x = dabs[offset + STAMP.CENTER_X]
        const y = dabs[offset + STAMP.CENTER_Y]
        const radius = dabs[offset + STAMP.RADIUS]
        // As far as the dab pass may write: the rim, or a turned tip's
        // corners, and the cell past it.
        const reach = radius * tipReach + WET_CELL_SIZE
        const lastColumn = tileIndexForPixel(x + reach)
        const lastRow = tileIndexForPixel(y + reach)
        for (let row = tileIndexForPixel(y - reach); row <= lastRow; row++)
          for (
            let column = tileIndexForPixel(x - reach);
            column <= lastColumn;
            column++
          ) {
            let held = tiles!.count()
            let slot = tiles!.touch(column, row)
            if (slot < 0) {
              // Every slot is taken (D42): a body settles early to make
              // room, the one this dab is painting into last of all, and
              // with drying paused a held one before one still moving. A
              // tile off the canvas has none to wait for, and lays nothing.
              if (
                held < WET_SLOTS ||
                column < 0 ||
                row < 0 ||
                column >= grid.columns ||
                row >= grid.rows
              )
                continue
              const crowding = tiles!.crowding(
                column,
                row,
                touched,
                paused ? clock : undefined
              )
              // What is waiting to be drawn is in the paint that settles.
              if (fresh > 0) writeSlots()
              fresh = 0
              drawInstances(filled)
              filled = 0
              // The layer is wet from here, if this stroke is its first.
              surface = painting
              const mark = settle(crowding)
              if (mark) (marks ??= []).push(mark)
              for (const freed of crowding) touched.delete(freed)
              held = tiles!.count()
              slot = tiles!.touch(column, row)
            }
            if (tiles!.count() > held) fresh++
            // And the ring about it (D42), where there are slots to spare:
            // a bloom may cross into a tile no dab reaches. Only water past
            // what the paper holds blooms, so only a brush that lays it
            // takes a ring: any other wets the tiles its dabs reach alone.
            if (flooding) fresh += tiles!.surround(column, row)
            touched.add(slot)
            reached[slot * 4] = Math.min(reached[slot * 4], x - reach)
            reached[slot * 4 + 1] = Math.min(reached[slot * 4 + 1], y - reach)
            reached[slot * 4 + 2] = Math.max(reached[slot * 4 + 2], x + reach)
            reached[slot * 4 + 3] = Math.max(reached[slot * 4 + 3], y + reach)
            if (filled === MAX_INSTANCES_PER_DRAW) {
              // A slot the pour cannot find is paint that is lost.
              if (fresh > 0) writeSlots()
              fresh = 0
              drawInstances(filled)
              filled = 0
            }
            place(dabs, offset, column, row, slot, filled++ * INSTANCE_STRIDE)
          }
      }
      // A slot the shaders cannot find is paint that does not show.
      if (fresh > 0) writeSlots()
      // Every dab pushes back the drying of the body it landed in.
      refreshTouched()
      if (flooding) for (const slot of touched) flooded[slot] = 1
      drawInstances(filled)
      if (touched.size === 0) return marks ?? noMarks
      laid = true
      if (surface === painting) context.wetMoved()
      else {
        // Wet from its first dab, and again if all of it dried under the pen.
        surface = painting
        context.wetChanged()
      }
      return marks ?? noMarks
    },
    end(keep) {
      if (!painting) return null
      const onto = painting
      painting = undefined
      blotting = false
      const kept = penDown
      penDown = undefined
      release(handover)
      handover = undefined
      // Cancelled, the wet fields are what they were at pen-down.
      if (!keep && kept) putBack(kept, onto)
      if (keep && laid) handover = kept
      else release(kept)
      // No tile changed: there is no mark for history until paint settles.
      return null
    },
    takeCopy() {
      const kept = handover
      handover = undefined
      return kept ?? null
    },
    copy: keepFields,
    restore: (copy, onto) => putBack(copy as KeptFields, onto),
    release: (copy) => release(copy as KeptFields),
    selectionChanged() {
      revision++
      shown = []
      settleBindings = []
      simBindings = []
      if (surface) context.wetChanged()
    },
    advance(steps) {
      const marks: StrokeMark[] = []
      if (!tiles) return marks
      if (advancing) return marks
      if (steps > 0 && needsEdges()) return advanceRuns(steps)
      let stepped = false
      for (let i = 0; i < steps && tiles.count() > heldCount; i++) {
        const encoder = device.createCommandEncoder()
        simulate(encoder, pipelines!.step)
        device.queue.submit([encoder.finish()])
        stepped = true
        clock++
        if (paused) {
          hold()
          continue
        }
        const mark = settle(tiles.expired(clock))
        if (mark) marks.push(mark)
      }
      if (stepped) context.wetMoved()
      return marks
    },
    setPaused(pause) {
      if (pause === paused) return
      revision++
      paused = pause
      if (!tiles) return
      if (pause) {
        writeSim()
        hold()
        return
      }
      // Drying goes on from where it stopped: every body, held or not, is
      // given the time the deepest water takes, since none evaporated while
      // it was paused.
      outlastDeepest()
      // Tells the step every slot moves again, and how fast water goes.
      writeSlots()
    },
    waterField() {
      return fields ? fields.copies[current].water.texture : null
    },
    setBoard(board) {
      revision++
      const down = boardDown(board)
      const fall = isFlat(board) ? 0 : STEEPEST_FALL * board.steepness
      simFall.set(fall ? [fall, down.x, down.y] : [0, 0, 0])
      writeSim()
    },
    dry() {
      return tiles ? settle(tiles.slots()) : null
    },
    drop(of) {
      if (of && of !== surface && of !== painting) return
      painting = undefined
      blotting = false
      release(penDown)
      penDown = undefined
      discard()
    },
    destroy() {
      revision++
      for (const kept of [...copies]) release(kept)
      for (const texture of fields?.textures ?? []) texture.destroy()
      slots?.texture.destroy()
      unselected.destroy()
      uniform.destroy()
      simUniform.destroy()
      instanceBuffer.destroy()
      runEdges.destroy()
      edgeReadback.destroy()
    },
  }
}
