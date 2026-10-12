import {
  createTouchedTiles,
  intersectRect,
  tileBounds,
  tileIndexForPixel,
  TILE_SIZE,
} from "../doc/tile-grid"
import { fluidDabShader, fluidSettleShader } from "../shaders/fluid"
import { STAMP, STAMP_STRIDE } from "./stamp-instance"
import type { StrokeMark, StrokeRenderer } from "./stroke-renderer"
import { LAYER_FORMAT, type Surface } from "./surface"
import {
  createWetTiles,
  WET_CELL_SIZE,
  WET_CELLS,
  type WetTiles,
} from "./wet-tiles"

/** Slots along one side of a field texture; see `wet.wgsl`. */
const FIELD_COLUMNS = 8
const FIELD_SIZE = FIELD_COLUMNS * WET_CELLS

/**
 * One dab in one wet tile, as the dab pass takes it: the centre and radius
 * in cells of the field texture, the pigment it carries, and its slot's box.
 */
const INSTANCE_STRIDE = 8

/**
 * Instances drawn in one pass. A dab is one for each tile it reaches, which
 * is one or two for all but the largest; past this the batch is drawn in
 * more passes than one, never in a larger buffer (D30).
 */
const MAX_INSTANCES_PER_DRAW = 4096

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
}

/** What the fluid stroke reads of, and asks of, the renderer it draws for. */
export type FluidStrokeContext = {
  /** The document's size in pixels. */
  size(): { width: number; height: number }
  /** The brush's rim falloff, in document pixels. */
  feather(): number
  /** A layer became wet or dry: whatever shows it has to bind it again. */
  wetChanged(): void
}

/**
 * The fluid stroke, and the wet surface it paints into: the two are one
 * module while a stroke is the only thing that makes or settles wet paint.
 */
export interface FluidStroke extends StrokeRenderer<FluidOpening> {
  /**
   * What the compositor shows over a layer's pixels: the wet tiles' slots
   * and their pigment, or placeholders that glaze nothing unless `surface`
   * is the one that is wet.
   */
  wet(surface: Surface): { slots: GPUTextureView; pigment: GPUTextureView }
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
  destroy(): void
}

/**
 * The third stroke renderer (D42, §6.2): a fluid brush's dabs lay water and
 * pigment into the wet surface of the active layer, and no tile changes
 * while the pen is down. The wet surface is sparse wet tiles on the
 * document's tile grid, each a slot in the field textures at half
 * resolution, shown inside the layer by the glaze function. Nothing
 * simulates yet: ending a stroke kept settles everything wet into the layer
 * through that same function and frees the slots.
 */
export function createFluidStroke(
  device: GPUDevice,
  context: FluidStrokeContext
): FluidStroke {
  const add: GPUBlendState = {
    color: { srcFactor: "one", dstFactor: "one" },
    alpha: { srcFactor: "one", dstFactor: "one" },
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
          ],
        },
      ],
    },
    fragment: {
      module: dabModule,
      entryPoint: "fragmentMain",
      targets: [
        { format: LAYER_FORMAT, blend: add },
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

  const uniform = device.createBuffer({
    size: 32,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const dabBinding = device.createBindGroup({
    layout: dabPipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniform } }],
  })
  const instances = new Float32Array(MAX_INSTANCES_PER_DRAW * INSTANCE_STRIDE)
  const instanceBuffer = device.createBuffer({
    size: instances.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  })

  // Bound where nothing is wet, so what shows a layer is always complete.
  const noSlots = device.createTexture({
    size: { width: 1, height: 1 },
    format: "r8uint",
    usage: GPUTextureUsage.TEXTURE_BINDING,
  })
  const noPigment = device.createTexture({
    size: { width: 1, height: 1 },
    format: LAYER_FORMAT,
    usage: GPUTextureUsage.TEXTURE_BINDING,
  })
  const dry = { slots: noSlots.createView(), pigment: noPigment.createView() }
  /** The same for the layer that is wet, made with the textures it names. */
  let shown: typeof dry | undefined
  const uniformValues = new Float32Array(8)

  /**
   * The wet fields, a slot per wet tile: standing water, and suspended
   * pigment premultiplied by its density. Sixteen mebibytes between them,
   * held from the first fluid brush on.
   */
  let fields:
    | {
        water: GPUTexture
        waterView: GPUTextureView
        pigment: GPUTexture
        pigmentView: GPUTextureView
        /** One tile of a layer, copied for settle to read. */
        under: GPUTexture
      }
    | undefined
  /** Each tile's slot, as the shaders read it; the size of the tile grid. */
  let slots: { texture: GPUTexture; view: GPUTextureView } | undefined
  let tiles: WetTiles | undefined
  let grid = { columns: 0, rows: 0 }
  let settleBinding: GPUBindGroup | undefined

  /** The layer that is wet, while any tile of it is. */
  let surface: Surface | undefined
  /** Whether a stroke is in flight. */
  let open = false
  let load = 1

  // What the stroke's dabs reached, for history: the box round the mark and
  // the tiles under each dab (live brushes 30).
  const painted = { left: 0, top: 0, right: 0, bottom: 0 }
  const paintedTiles = createTouchedTiles()

  function resetPainted() {
    painted.left = Infinity
    painted.top = Infinity
    painted.right = -Infinity
    painted.bottom = -Infinity
    paintedTiles.clear()
  }
  resetPainted()

  function field(): GPUTexture {
    return device.createTexture({
      size: { width: FIELD_SIZE, height: FIELD_SIZE },
      format: LAYER_FORMAT,
      usage:
        GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
    })
  }

  function prepare() {
    const { width, height } = context.size()
    const columns = Math.ceil(width / TILE_SIZE)
    const rows = Math.ceil(height / TILE_SIZE)
    if (!fields) {
      const water = field()
      const pigment = field()
      fields = {
        water,
        waterView: water.createView(),
        pigment,
        pigmentView: pigment.createView(),
        under: device.createTexture({
          size: { width: TILE_SIZE, height: TILE_SIZE },
          format: LAYER_FORMAT,
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        }),
      }
      settleBinding = undefined
      shown = undefined
      shown = undefined
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
    settleBinding = undefined
    shown = undefined
  }

  function writeSlots() {
    device.queue.writeTexture(
      { texture: slots!.texture },
      tiles!.map(),
      { bytesPerRow: grid.columns },
      { width: grid.columns, height: grid.rows }
    )
  }

  /** Frees every slot and empties the fields: the layer is dry. */
  function release() {
    if (!surface) return
    surface = undefined
    tiles!.clear()
    writeSlots()
    // Every slot is freed together, so the fields are cleared whole.
    const encoder = device.createCommandEncoder()
    encoder
      .beginRenderPass({
        colorAttachments: [fields!.waterView, fields!.pigmentView].map(
          (view) => ({
            view,
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: "clear" as const,
            storeOp: "store" as const,
          })
        ),
      })
      .end()
    device.queue.submit([encoder.finish()])
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
      // The fields hold the wet paint so far: dabs add to it.
      colorAttachments: [fields!.waterView, fields!.pigmentView].map(
        (view) => ({
          view,
          loadOp: "load" as const,
          storeOp: "store" as const,
        })
      ),
    })
    pass.setPipeline(dabPipeline)
    pass.setBindGroup(0, dabBinding)
    pass.setVertexBuffer(0, instanceBuffer)
    pass.draw(4, count)
    pass.end()
    device.queue.submit([encoder.finish()])
  }

  /**
   * Glazes everything wet onto the layer, a tile at a time, and frees it.
   * Answers what the stroke's dabs reached, or null when they laid nothing.
   */
  function settle(): StrokeMark | null {
    const target = surface
    if (!target) return null
    const { width, height } = context.size()
    const canvas = { x: 0, y: 0, width, height }
    settleBinding ??= device.createBindGroup({
      layout: settlePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: fields!.under.createView() },
        { binding: 1, resource: slots!.view },
        { binding: 2, resource: fields!.pigmentView },
      ],
    })
    const encoder = device.createCommandEncoder()
    for (const tile of tiles!.tiles()) {
      // Edge tiles hang past the canvas; only what is on it is settled.
      const visible = intersectRect(tileBounds(tile), canvas)
      if (!visible) continue
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
      pass.setPipeline(settlePipeline)
      pass.setBindGroup(0, settleBinding)
      pass.setScissorRect(visible.x, visible.y, visible.width, visible.height)
      pass.draw(3)
      pass.end()
    }
    device.queue.submit([encoder.finish()])
    target.empty = false

    const x = Math.max(0, Math.floor(painted.left))
    const y = Math.max(0, Math.floor(painted.top))
    const right = Math.min(width, Math.ceil(painted.right))
    const bottom = Math.min(height, Math.ceil(painted.bottom))
    const region =
      right > x && bottom > y
        ? { x, y, width: right - x, height: bottom - y }
        : null
    const mark = region ? { region, tiles: paintedTiles.within(region) } : null
    release()
    return mark
  }

  return {
    wet(of) {
      if (!surface || of !== surface) return dry
      shown ??= { slots: slots!.view, pigment: fields!.pigmentView }
      return shown
    },
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
      // Ends any stroke still in flight, as the other renderers do.
      release()
      prepare()
      resetPainted()
      surface = opening.surface
      open = true
      load = opening.load
      uniformValues.set(opening.ink)
      uniformValues[4] = FIELD_SIZE
      uniformValues[5] = FIELD_SIZE
      uniformValues[6] = context.feather() / WET_CELL_SIZE
      uniformValues[7] = opening.water
      device.queue.writeBuffer(uniform, 0, uniformValues)
      context.wetChanged()
      return true
    },
    /** Dabs are laid out as `STAMP` says; only a round tip is drawn so far. */
    draw(dabs, count) {
      if (!open || count <= 0) return
      const before = tiles!.count()
      let filled = 0
      for (let i = 0; i < count; i++) {
        const offset = i * STAMP_STRIDE
        const x = dabs[offset + STAMP.CENTER_X]
        const y = dabs[offset + STAMP.CENTER_Y]
        const radius = dabs[offset + STAMP.RADIUS]
        // As far as the dab pass may write: the rim, and the cell past it.
        const reach = radius + WET_CELL_SIZE
        painted.left = Math.min(painted.left, x - reach)
        painted.top = Math.min(painted.top, y - reach)
        painted.right = Math.max(painted.right, x + reach)
        painted.bottom = Math.max(painted.bottom, y + reach)
        paintedTiles.include(
          Math.floor(x - reach),
          Math.floor(y - reach),
          Math.ceil(x + reach),
          Math.ceil(y + reach)
        )
        const lastColumn = tileIndexForPixel(x + reach)
        const lastRow = tileIndexForPixel(y + reach)
        for (let row = tileIndexForPixel(y - reach); row <= lastRow; row++)
          for (
            let column = tileIndexForPixel(x - reach);
            column <= lastColumn;
            column++
          ) {
            // A tile with no slot to take lays nothing: off the canvas, or
            // past the wet tile limit.
            const slot = tiles!.touch(column, row)
            if (slot < 0) continue
            if (filled === MAX_INSTANCES_PER_DRAW) {
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
          }
      }
      // A slot the shaders cannot find is paint that does not show.
      if (tiles!.count() !== before) writeSlots()
      drawInstances(filled)
    },
    end(keep) {
      if (!open) return null
      open = false
      if (keep) return settle()
      // Nothing was wet before the stroke, so nothing is after it.
      release()
      resetPainted()
      return null
    },
    drop(of) {
      if (of && of !== surface) return
      open = false
      release()
    },
    destroy() {
      fields?.water.destroy()
      fields?.pigment.destroy()
      fields?.under.destroy()
      slots?.texture.destroy()
      noSlots.destroy()
      noPigment.destroy()
      uniform.destroy()
      instanceBuffer.destroy()
    },
  }
}
