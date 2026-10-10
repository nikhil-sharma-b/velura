import { type PixelRect, TILE_SIZE } from "../doc/tile-grid"
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

/**
 * The direct stroke, and what the renderer has to tell it about the things
 * it holds on to between dabs.
 */
export interface DirectStroke extends StrokeRenderer<Surface> {
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
 * each dab is mixed towards the pixel one dab's travel behind it, so what was
 * under the tip a step ago is dragged to where the tip is now.
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
  const pipeline = device.createRenderPipeline({
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
  })
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
    // Nothing outside the selection's bounds is selected (smudge 03), so a
    // dab draws only within them, and one clear of them draws nothing.
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
      if (!stroke.last) {
        stroke.last = { x, y }
        continue
      }
      const travelX = x - stroke.last.x
      const travelY = y - stroke.last.y
      stroke.last.x = x
      stroke.last.y = y
      // A still tip drags nothing, and nor does one with no strength: a
      // stroke at none leaves the layer, and its history, as they were.
      if (travelX === 0 && travelY === 0) continue
      if (!(dabs[dab + SMUDGE.STRENGTH] > 0)) continue
      // Rotated textured quads fit inside sqrt(2) radii.
      const reach = dabs[dab + SMUDGE.RADIUS] * Math.SQRT2
      const left = Math.max(clipLeft, Math.floor(x - reach))
      const top = Math.max(clipTop, Math.floor(y - reach))
      const right = Math.min(clipRight, Math.ceil(x + reach))
      const bottom = Math.min(clipBottom, Math.ceil(y + reach))
      if (right <= left || bottom <= top) continue
      // What the dab reads: the pixels it covers and the ones its travel
      // behind them, with a texel to spare for the blend between texels.
      const fromLeft = Math.max(
        0,
        Math.floor(Math.min(left, left - travelX)) - 1
      )
      const fromTop = Math.max(0, Math.floor(Math.min(top, top - travelY)) - 1)
      const fromRight = Math.min(
        width,
        Math.ceil(Math.max(right, right - travelX)) + 1
      )
      const fromBottom = Math.min(
        height,
        Math.ceil(Math.max(bottom, bottom - travelY)) + 1
      )
      const span = Math.max(fromRight - fromLeft, fromBottom - fromTop)
      if (span > MAX_CARRY_SIZE) continue
      need = Math.max(need, span)
      const instance = drawn * SMUDGE_INSTANCE_STRIDE
      drawnDabs.set(dabs.subarray(dab, dab + SMUDGE_STRIDE), instance)
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
      rects[rect + 6] = right - left
      rects[rect + 7] = bottom - top
      stroke.reached.left = Math.min(stroke.reached.left, left)
      stroke.reached.top = Math.min(stroke.reached.top, top)
      stroke.reached.right = Math.max(stroke.reached.right, right)
      stroke.reached.bottom = Math.max(stroke.reached.bottom, bottom)
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
    }
    const tip = context.tip()
    params[0] = width
    params[1] = height
    params[2] = tip.feather
    params[3] = tip.usesTip ? 1 : 0
    params[4] = selection ? 1 : 0
    device.queue.writeBuffer(uniform, 0, params)
    device.queue.writeBuffer(
      instances,
      0,
      drawnDabs,
      0,
      drawn * SMUDGE_INSTANCE_STRIDE
    )
    // Kept between frames of a stroke, which must allocate nothing (D30).
    bindGroup ??= device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
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
      ],
    })
    // Each dab reads what the one before it wrote, so each is a copy and a
    // pass of its own; one encoder holds the frame's worth in order.
    const encoder = device.createCommandEncoder()
    const tilesAcross = Math.ceil(width / TILE_SIZE)
    for (let i = 0; i < drawn; i++) {
      const rect = i * 8
      // Before the dab writes: any tile under it that no dab has yet touched
      // is kept as it is.
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
      encoder.copyTextureToTexture(
        {
          texture: stroke.target.texture,
          origin: { x: rects[rect], y: rects[rect + 1] },
        },
        { texture: carry },
        { width: rects[rect + 2], height: rects[rect + 3] }
      )
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          { view: stroke.target.view, loadOp: "load", storeOp: "store" },
        ],
      })
      pass.setPipeline(pipeline)
      pass.setBindGroup(0, bindGroup)
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
    const { target, reached, kept } = session
    session = undefined
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
    }
    trimBackup()
    return keep ? region : null
  }

  return {
    /**
     * Nothing is copied yet: each tile is kept as it is when a dab first
     * writes to it. A surface that holds nothing has nothing to smear.
     */
    begin(target) {
      if (target.empty) return false
      if (session) end(false)
      session = {
        target,
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
     * Dabs are laid out as `SMUDGE` says. The first of a stroke has nothing
     * behind it and only marks where the stroke began.
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
    },
    drop(surface) {
      if (surface && session?.target !== surface) return
      session = undefined
      trimBackup()
    },
    destroy() {
      session = undefined
      for (const page of backupPages.splice(0)) page.destroy()
      carry?.destroy()
      carry = undefined
      bindGroup = undefined
      uniform.destroy()
      instances.destroy()
    },
  }
}
