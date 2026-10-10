import { type PixelRect, TILE_SIZE } from "../doc/tile-grid"
import type { LinearColor } from "../doc/tiled-layer"
import { smudgeShader } from "../shaders/smudge"
import {
  MAX_SMUDGE_DABS_PER_DRAW,
  SMUDGE,
  SMUDGE_INSTANCE_STRIDE,
  SMUDGE_STRIDE,
} from "./smudge-dab"
import type { StrokeRenderer } from "./stroke-renderer"
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
  /** The selection's coverage and bounds, while there is one. */
  selection(): { texture: GPUTexture; bounds: PixelRect } | undefined
  /** Bound for the selection while nothing is selected; the shader skips it. */
  noSelection: GPUTexture
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
}

/**
 * The direct stroke, and what the renderer has to tell it about the things
 * it holds on to between dabs.
 */
export interface DirectStroke extends StrokeRenderer<DirectOpening> {
  /** The tip or the selection was replaced: the views held of them are stale. */
  invalidateBinding(): void
  /**
   * Lets go of the stroke in flight without putting anything back, because
   * its surface is going away. Given a surface, only a stroke on that one.
   */
  drop(surface?: Surface): void
  destroy(): void
}

/** Tiles to a side of one page of the backup. */
const BACKUP_PAGE_TILES = 8
const BACKUP_PAGE_SLOTS = BACKUP_PAGE_TILES * BACKUP_PAGE_TILES
/** The widest neighbourhood a dab may ask for; one reaching further is skipped. */
const MAX_CARRY_SIZE = 2048

/**
 * The stroke that reads and writes its surface as it goes (D29, smudge 01):
 * smudge mixes towards the pixel one dab behind. Wet brushes exchange paint
 * with a stroke-local reservoir held in tip coordinates (D41).
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
        /** Whether the stroke lays colour: a wet brush's, and not smudge's. */
        lays: boolean
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
   * kept; the first stays between strokes, as the carry does.
   */
  const backupPages: GPUTexture[] = []
  /**
   * What a dab reads: its own neighbourhood of the surface, copied out
   * because a pass cannot read what it writes. Dab-sized, kept between
   * strokes, and grown when a dab needs more.
   */
  let carry: GPUTexture | undefined
  /**
   * Holds the tip's, the carry's and the selection's views, so it goes when
   * any of them is replaced.
   */
  let bindGroup: GPUBindGroup | undefined
  const params = new Float32Array(8)
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
        GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
    })
  )
  const reservoirViews = reservoirs.map((texture) => texture.createView())
  let reservoirExtent = 0
  let reservoirIndex = 0
  let reservoirBindings: { layer: GPUBindGroup; pickup: GPUBindGroup }[] = []
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
  const rects = new Int32Array(MAX_SMUDGE_DABS_PER_DRAW * 8)

  /** Draws the dabs of the stroke into its surface, one after another. */
  function drawDabs(dabs: Float32Array, count: number) {
    const stroke = session!
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
    let need = 0
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
        !stroke.target.empty
      const picksUp = stroke.lays && dabs[dab + SMUDGE.STRENGTH] > 0
      if (!drags && !(flow > 0) && !picksUp) continue
      // Rotated textured quads fit inside sqrt(2) radii.
      const reach = dabs[dab + SMUDGE.RADIUS] * Math.SQRT2
      const left = Math.max(clipLeft, Math.floor(x - reach))
      const top = Math.max(clipTop, Math.floor(y - reach))
      const right = Math.min(clipRight, Math.ceil(x + reach))
      const bottom = Math.min(clipBottom, Math.ceil(y + reach))
      const writes = right > left && bottom > top && (drags || flow > 0)
      if (!writes && !picksUp) continue
      // Wet pickup reads the full tip, including outside selections. Smudge
      // also needs the pixels one travel behind. A texel borders the blend.
      const fromLeft = Math.max(
        0,
        Math.floor(stroke.lays ? x - reach : Math.min(left, left - travelX)) - 1
      )
      const fromTop = Math.max(
        0,
        Math.floor(stroke.lays ? y - reach : Math.min(top, top - travelY)) - 1
      )
      const fromRight = Math.min(
        width,
        Math.ceil(stroke.lays ? x + reach : Math.max(right, right - travelX)) +
          1
      )
      const fromBottom = Math.min(
        height,
        Math.ceil(
          stroke.lays ? y + reach : Math.max(bottom, bottom - travelY)
        ) + 1
      )
      if (fromRight <= fromLeft || fromBottom <= fromTop) continue
      const span = Math.max(fromRight - fromLeft, fromBottom - fromTop)
      if (span > MAX_CARRY_SIZE) continue
      need = Math.max(need, span)
      const instance = drawn * SMUDGE_INSTANCE_STRIDE
      drawnDabs.set(dabs.subarray(dab, dab + SMUDGE_STRIDE), instance)
      drawnDabs[instance + SMUDGE.FLOW] = flow
      drawnDabs[instance + SMUDGE.TRAVEL_X] = travelX
      drawnDabs[instance + SMUDGE.TRAVEL_Y] = travelY
      drawnDabs[instance + SMUDGE.ORIGIN_X] = fromLeft
      drawnDabs[instance + SMUDGE.ORIGIN_Y] = fromTop
      const rect = drawn * 8
      rects[rect] = fromLeft
      rects[rect + 1] = fromTop
      rects[rect + 2] = fromRight - fromLeft
      rects[rect + 3] = fromBottom - fromTop
      rects[rect + 4] = left
      rects[rect + 5] = top
      rects[rect + 6] = writes ? right - left : 0
      rects[rect + 7] = writes ? bottom - top : 0
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
    if (!carry || carry.width < need) {
      carry?.destroy()
      let size = 64
      while (size < need) size *= 2
      carry = device.createTexture({
        size: { width: size, height: size },
        format: LAYER_FORMAT,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      })
      bindGroup = undefined
      reservoirBindings = []
    }
    const tip = context.tip()
    params[0] = width
    params[1] = height
    params[2] = tip.feather
    params[3] = tip.usesTip ? 1 : 0
    params[4] = selection ? 1 : 0
    params[5] = stroke.lays ? 1 : 0
    if (stroke.lays && reservoirExtent === 0) {
      reservoirExtent = Math.min(
        reservoirSize,
        Math.max(64, Math.ceil(drawnDabs[SMUDGE.RADIUS] * 2))
      )
    }
    params[6] = reservoirExtent / reservoirSize
    device.queue.writeBuffer(uniform, 0, params)
    device.queue.writeBuffer(
      instances,
      0,
      drawnDabs,
      0,
      drawn * SMUDGE_INSTANCE_STRIDE
    )
    // Kept between frames of a stroke, which must allocate nothing (D30).
    if (!bindGroup || reservoirBindings.length === 0) {
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
      reservoirBindings = reservoirViews.map((resource) => ({
        layer: device.createBindGroup({
          layout: pipeline.getBindGroupLayout(0),
          entries: [...entries, { binding: 6, resource }],
        }),
        pickup: device.createBindGroup({
          layout: reservoirPipeline.getBindGroupLayout(0),
          entries: [...entries.slice(0, 5), { binding: 6, resource }],
        }),
      }))
      bindGroup = reservoirBindings[0].layer
    }
    // Each dab reads what the one before it wrote, so each is a copy and a
    // pass of its own; one encoder holds the frame's worth in order.
    const encoder = device.createCommandEncoder()
    const tilesAcross = Math.ceil(width / TILE_SIZE)
    for (let i = 0; i < drawn; i++) {
      const rect = i * 8
      // Before the dab writes: any tile under it that no dab has yet touched
      // is kept as it is.
      if (rects[rect + 6] > 0 && rects[rect + 7] > 0) {
        const lastColumn = (rects[rect + 4] + rects[rect + 6] - 1) >> TILE_SHIFT
        const lastRow = (rects[rect + 5] + rects[rect + 7] - 1) >> TILE_SHIFT
        for (let row = rects[rect + 5] >> TILE_SHIFT; row <= lastRow; row++)
          for (
            let column = rects[rect + 4] >> TILE_SHIFT;
            column <= lastColumn;
            column++
          ) {
            const tile = row * tilesAcross + column
            if (stroke.kept.has(tile)) continue
            const slot = stroke.kept.size
            stroke.kept.set(tile, slot)
            copyBackupTile(encoder, stroke.target, tile, slot, "keep")
          }
      }
      encoder.copyTextureToTexture(
        {
          texture: stroke.target.texture,
          origin: { x: rects[rect], y: rects[rect + 1] },
        },
        { texture: carry },
        { width: rects[rect + 2], height: rects[rect + 3] }
      )
      if (rects[rect + 6] > 0 && rects[rect + 7] > 0) {
        const pass = encoder.beginRenderPass({
          colorAttachments: [
            { view: stroke.target.view, loadOp: "load", storeOp: "store" },
          ],
        })
        pass.setPipeline(pipeline)
        pass.setBindGroup(
          0,
          stroke.lays ? reservoirBindings[reservoirIndex].layer : bindGroup
        )
        pass.setVertexBuffer(0, instances)
        pass.setScissorRect(
          rects[rect + 4],
          rects[rect + 5],
          rects[rect + 6],
          rects[rect + 7]
        )
        pass.draw(6, 1, 0, i)
        pass.end()
      }
      if (
        stroke.lays &&
        drawnDabs[i * SMUDGE_INSTANCE_STRIDE + SMUDGE.STRENGTH] > 0
      ) {
        const next = 1 - reservoirIndex
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
        reservoirIndex = next
      }
    }
    device.queue.submit([encoder.finish()])
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
    direction: "keep" | "restore"
  ) {
    const { width, height } = context.size()
    const page = Math.floor(slot / BACKUP_PAGE_SLOTS)
    // The one allocation a stroke may make as it goes, once in as many tiles
    // as a page holds: the alternative is paying for the document at pen-down.
    while (backupPages.length <= page)
      backupPages.push(
        device.createTexture({
          label: "smudge backup",
          size: {
            width: BACKUP_PAGE_TILES * TILE_SIZE,
            height: BACKUP_PAGE_TILES * TILE_SIZE,
          },
          format: LAYER_FORMAT,
          usage: GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST,
        })
      )
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
        width: Math.min(TILE_SIZE, width - x),
        height: Math.min(TILE_SIZE, height - y),
      }
    )
  }

  /** Gives back the pages a long stroke needed; the first is kept. */
  function trimBackup() {
    while (backupPages.length > 1) backupPages.pop()!.destroy()
  }

  function end(keep: boolean): PixelRect | null {
    if (!session) return null
    const { target, reached, kept, wasEmpty, lays } = session
    session = undefined
    if (lays) clearReservoir()
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
    return keep ? region : null
  }

  return {
    /**
     * Nothing is copied yet: each tile is kept as it is when a dab first
     * writes to it. A surface that holds nothing has nothing to smear, so
     * only a stroke that lays colour opens on one.
     */
    begin({ target, lay }) {
      if (target.empty && !lay) return false
      if (session) end(false)
      if (lay) clearReservoir(lay)
      session = {
        target,
        lays: !!lay,
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
    invalidateBinding() {
      bindGroup = undefined
      reservoirBindings = []
    },
    drop(surface) {
      if (surface && session?.target !== surface) return
      if (session?.lays) clearReservoir()
      session = undefined
      trimBackup()
    },
    destroy() {
      session = undefined
      for (const page of backupPages.splice(0)) page.destroy()
      for (const texture of reservoirs) texture.destroy()
      carry?.destroy()
      carry = undefined
      bindGroup = undefined
      uniform.destroy()
      instances.destroy()
    },
  }
}
