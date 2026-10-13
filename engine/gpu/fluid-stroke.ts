import {
  intersectRect,
  tileBounds,
  tileIndexForPixel,
  TILE_SIZE,
  type TileCoord,
} from "../doc/tile-grid"
import type { WetCopy } from "../doc/undo-stack"
import {
  FLUID_DAMP_STEPS,
  FLUID_HOLDS,
  FLUID_MAX_WATER,
  FLUID_RELIEF,
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
 * Bytes of the simulation's uniform: its rates and the brush's water, then a
 * row for each slot.
 */
const SIM_LEVEL_OFFSET = 16
const SIM_TILES_OFFSET = 32
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
  /**
   * Runs the simulation on by `steps` steps, fewer if everything dries
   * first. A body whose deadline passes settles into the layer; answers what
   * each such settle wrote, in order.
   */
  advance(steps: number): StrokeMark[]
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
    const dabPipeline = device.createRenderPipeline({
      label: "fluid dabs",
      layout: "auto",
      vertex: {
        module: dabModule,
        entryPoint: "vertexMain",
        buffers: [
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
        ],
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
      settle: settlePipeline,
      simLayout,
      step: simPipeline("stepMain"),
      pour: simPipeline("pourMain"),
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
  const simData = new ArrayBuffer(SIM_UNIFORM_SIZE)
  const simRates = new Float32Array(simData, 0, 4)
  /** The depth of water the brush in hand fills a cell to. */
  const simLevel = new Float32Array(simData, SIM_LEVEL_OFFSET, 1)
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
      layout: pipelines!.dab.getBindGroupLayout(0),
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
  /** The last kept stroke's pen-down copy, until it is taken. */
  let handover: KeptFields | undefined
  /** Every copy not yet released. */
  const copies = new Set<KeptFields>()
  let load = 1
  /** Steps run since the fields were made: what deadlines are counted in. */
  let clock = 0
  /** Steps a body outlives its last dab by, at the brush's drying. */
  let lifetime = 0

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
    span = 0
    shown = []
    settleBindings = []
    simBindings = []
  }

  /** Tells the shaders which tiles hold which slots. */
  function writeSlots() {
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
    device.queue.writeBuffer(simUniform, 0, simData)
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
      ],
    })
    const pass = encoder.beginComputePass()
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, simBindings[current])
    pass.dispatchWorkgroups(WET_CELLS / 8, WET_CELLS / 8, span)
    pass.end()
    current = 1 - current
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
      colorAttachments: [fields!.laidWater, fields!.laidPigment].map(
        (view) => ({
          view,
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: "clear" as const,
          storeOp: "store" as const,
        })
      ),
    })
    pass.setPipeline(pipelines!.dab)
    pass.setBindGroup(0, bindDabs())
    pass.setVertexBuffer(0, instanceBuffer)
    pass.draw(4, count)
    pass.end()
    simulate(encoder, pipelines!.pour)
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
    prepare,
    begin(opening) {
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
      // dried this one first.
      if (surface && surface !== opening.surface)
        throw new Error("Another layer is still wet.")
      painting = opening.surface
      // Before the brush's rates are put to the wash: they are undone too.
      release(penDown)
      penDown = keepFields()
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
      // The whole wet surface runs at the rates of the brush last put to it.
      const slower = evaporation(opening.drying) < simRates[0]
      simRates[0] = evaporation(opening.drying)
      simRates[1] = MAX_BLEED * opening.bleed
      simRates[2] = MAX_EDGE * opening.edge
      simRates[3] = MAX_GRANULATION * opening.granulation
      simLevel[0] = opening.water
      const depth = opening.water * FLUID_MAX_WATER
      flooding = depth > FLUID_HOLDS
      device.queue.writeBuffer(simUniform, 0, simData)
      /** Steps for water so deep to be gone, and the paper dry after it. */
      const outlasting = (water: number) =>
        Math.ceil(water / simRates[0]) + FLUID_DAMP_STEPS + DRYING_MARGIN
      // The brush fills a cell no deeper than its own water, and levelling
      // raises it by no more than the paper's relief is worth.
      lifetime = outlasting(Math.min(depth + FLUID_RELIEF, FLUID_MAX_WATER))
      // Paint already wet dries more slowly from here on, so it is given
      // the time, as for the deepest water there may be: a deadline is not
      // to pass with water still standing.
      if (slower)
        for (const slot of tiles!.slots()) {
          const tile = tiles!.tile(slot)!
          tiles!.refresh(tile.x, tile.y, clock + outlasting(FLUID_MAX_WATER))
        }
      return true
    },
    /** Dabs are laid out as `STAMP` says. */
    draw(dabs, count) {
      if (!painting || count <= 0) return noMarks
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
              // room, the one this dab is painting into last of all. A tile
              // off the canvas has none to wait for, and lays nothing.
              if (
                held < WET_SLOTS ||
                column < 0 ||
                row < 0 ||
                column >= grid.columns ||
                row >= grid.rows
              )
                continue
              const crowding = tiles!.crowding(column, row, touched)
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
            const slotX = (slot % FIELD_COLUMNS) * WET_CELLS
            const slotY = Math.floor(slot / FIELD_COLUMNS) * WET_CELLS
            const at = filled++ * INSTANCE_STRIDE
            instances[at] = x / WET_CELL_SIZE - column * WET_CELLS + slotX
            instances[at + 1] = y / WET_CELL_SIZE - row * WET_CELLS + slotY
            instances[at + 2] = radius / WET_CELL_SIZE
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
      shown = []
      settleBindings = []
      simBindings = []
      if (surface) context.wetChanged()
    },
    advance(steps) {
      const marks: StrokeMark[] = []
      if (!tiles) return marks
      let stepped = false
      for (let i = 0; i < steps && tiles.count() > 0; i++) {
        const encoder = device.createCommandEncoder()
        simulate(encoder, pipelines!.step)
        device.queue.submit([encoder.finish()])
        stepped = true
        clock++
        const mark = settle(tiles.expired(clock))
        if (mark) marks.push(mark)
      }
      if (stepped) context.wetMoved()
      return marks
    },
    dry() {
      return tiles ? settle(tiles.slots()) : null
    },
    drop(of) {
      if (of && of !== surface && of !== painting) return
      painting = undefined
      release(penDown)
      penDown = undefined
      discard()
    },
    destroy() {
      for (const kept of [...copies]) release(kept)
      for (const texture of fields?.textures ?? []) texture.destroy()
      slots?.texture.destroy()
      unselected.destroy()
      uniform.destroy()
      simUniform.destroy()
      instanceBuffer.destroy()
    },
  }
}
