import {
  intersectRect,
  type PixelRect,
  TILE_SIZE,
  TILE_TEXELS,
  type TileCoord,
  tileBounds,
  tileIndexForPixel,
  tileKey,
  tilesCoveringRect,
} from "./tile-grid"

/**
 * The document's selection (07): one byte of coverage per pixel, tiled like
 * the layers so a region nothing is selected in holds no tile at all.
 *
 * A mask is immutable. Every operation returns a new one that shares the
 * tiles it did not change, which is what makes keeping each selection an
 * undo step can return to cost next to nothing — and a tile wholly inside
 * the selection is one shared full tile rather than 64KB of its own.
 */
export interface SelectionMask {
  readonly width: number
  readonly height: number
  /** The smallest rectangle holding every selected pixel. Never empty. */
  readonly bounds: PixelRect
  /** 0 where unselected, 255 where wholly selected, between on a soft edge. */
  coverage(x: number, y: number): number
  tiles(): SelectionTile[]
  tileCount(): number
}

export type SelectionTile = TileCoord & {
  /** TILE_SIZE² bytes, row-major; texels off the canvas are meaningless. */
  readonly coverage: Uint8Array
  /** The shared tile that is selected throughout. */
  readonly full: boolean
}

type Size = { width: number; height: number }

const FULL_TILE = new Uint8Array(TILE_TEXELS).fill(255)

function createSelection(
  size: Size,
  tiles: ReadonlyMap<string, SelectionTile>
): SelectionMask | null {
  const bounds = measure(size, tiles)
  if (!bounds) return null
  return Object.freeze({
    width: size.width,
    height: size.height,
    bounds,
    coverage(x: number, y: number) {
      if (x < 0 || y < 0 || x >= size.width || y >= size.height) return 0
      const tile = tiles.get(
        tileKey(tileIndexForPixel(x), tileIndexForPixel(y))
      )
      if (!tile) return 0
      return tile.coverage[(y % TILE_SIZE) * TILE_SIZE + (x % TILE_SIZE)]
    },
    tiles: () => [...tiles.values()],
    tileCount: () => tiles.size,
  })
}

/** The part of a tile on the canvas: the only texels a mask speaks for. */
function visiblePart(coord: TileCoord, size: Size): PixelRect | null {
  return intersectRect(tileBounds(coord), { x: 0, y: 0, ...size })
}

/** The tight box of every covered texel, found tile by tile. */
function measure(
  size: Size,
  tiles: ReadonlyMap<string, SelectionTile>
): PixelRect | null {
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  for (const tile of tiles.values()) {
    const visible = visiblePart(tile, size)
    if (!visible) continue
    const include = (x0: number, y0: number, x1: number, y1: number) => {
      left = Math.min(left, x0)
      top = Math.min(top, y0)
      right = Math.max(right, x1)
      bottom = Math.max(bottom, y1)
    }
    if (tile.full) {
      include(
        visible.x,
        visible.y,
        visible.x + visible.width,
        visible.y + visible.height
      )
      continue
    }
    const originX = tile.x * TILE_SIZE
    const originY = tile.y * TILE_SIZE
    for (let y = visible.y; y < visible.y + visible.height; y++) {
      const row = (y - originY) * TILE_SIZE - originX
      for (let x = visible.x; x < visible.x + visible.width; x++)
        if (tile.coverage[row + x] !== 0) include(x, y, x + 1, y + 1)
    }
  }
  if (left === Infinity) return null
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/**
 * Keeps a tile as the mask should hold it: nothing where none of the canvas
 * under it is selected, the shared full tile where all of it is, and its own
 * bytes only in between.
 */
function settle(
  coord: TileCoord,
  coverage: Uint8Array,
  size: Size
): SelectionTile | null {
  const visible = visiblePart(coord, size)
  if (!visible) return null
  let any = false
  let all = true
  const originX = coord.x * TILE_SIZE
  const originY = coord.y * TILE_SIZE
  for (let y = visible.y; y < visible.y + visible.height; y++) {
    const row = (y - originY) * TILE_SIZE - originX
    for (let x = visible.x; x < visible.x + visible.width; x++) {
      const value = coverage[row + x]
      if (value !== 0) any = true
      if (value !== 255) all = false
    }
  }
  if (!any) return null
  if (all) return { ...coord, coverage: FULL_TILE, full: true }
  return { ...coord, coverage, full: false }
}

/**
 * Rasterises coverage over the tiles a box touches on the canvas. `whole`
 * answers, for the canvas part of a tile, whether the shape certainly covers
 * all of it: those tiles become the shared full tile without a texel being
 * evaluated, which is what keeps a drag over a large canvas cheap per frame.
 */
function rasterise(
  size: Size,
  box: PixelRect,
  coverageAt: (x: number, y: number) => number,
  whole: (part: PixelRect) => boolean
): SelectionMask | null {
  const clipped = intersectRect(box, { x: 0, y: 0, ...size })
  if (!clipped) return null
  const tiles = new Map<string, SelectionTile>()
  for (const coord of tilesCoveringRect(clipped)) {
    const visible = visiblePart(coord, size)
    if (visible && whole(visible)) {
      tiles.set(tileKey(coord.x, coord.y), {
        ...coord,
        coverage: FULL_TILE,
        full: true,
      })
      continue
    }
    const span = intersectRect(clipped, tileBounds(coord))
    if (!span) continue
    const coverage = new Uint8Array(TILE_TEXELS)
    const originX = coord.x * TILE_SIZE
    const originY = coord.y * TILE_SIZE
    for (let y = span.y; y < span.y + span.height; y++) {
      const row = (y - originY) * TILE_SIZE - originX
      for (let x = span.x; x < span.x + span.width; x++)
        coverage[row + x] = coverageAt(x, y)
    }
    const tile = settle(coord, coverage, size)
    if (tile) tiles.set(tileKey(coord.x, coord.y), tile)
  }
  return createSelection(size, tiles)
}

/** Whole pixels: a marquee has hard edges, so its corners snap. */
function snapRect(rect: PixelRect): PixelRect {
  const x = Math.round(rect.x)
  const y = Math.round(rect.y)
  return {
    x,
    y,
    width: Math.round(rect.x + rect.width) - x,
    height: Math.round(rect.y + rect.height) - y,
  }
}

export function rectSelection(
  size: Size,
  rect: PixelRect
): SelectionMask | null {
  const snapped = snapRect(rect)
  if (snapped.width <= 0 || snapped.height <= 0) return null
  const inside = (part: PixelRect) =>
    part.x >= snapped.x &&
    part.y >= snapped.y &&
    part.x + part.width <= snapped.x + snapped.width &&
    part.y + part.height <= snapped.y + snapped.height
  return rasterise(size, snapped, () => 255, inside)
}

/**
 * An ellipse inscribed in `rect`, antialiased: each pixel is covered by how
 * far its centre sits inside the rim, measured in pixels along the ellipse's
 * gradient, so the edge is one pixel soft at every size and aspect.
 */
export function ellipseSelection(
  size: Size,
  rect: PixelRect
): SelectionMask | null {
  const snapped = snapRect(rect)
  if (snapped.width <= 0 || snapped.height <= 0) return null
  const rx = snapped.width / 2
  const ry = snapped.height / 2
  const cx = snapped.x + rx
  const cy = snapped.y + ry
  const field = (x: number, y: number) => {
    const nx = (x + 0.5 - cx) / rx
    const ny = (y + 0.5 - cy) / ry
    return nx * nx + ny * ny
  }
  // Inside this level of the field every pixel is at least two pixels in
  // from the rim, so wholly covered. The level set of a convex field is
  // convex: a tile whose four corner pixels are in it is in it throughout.
  const shrink = Math.max(0, 1 - 2 / Math.min(rx, ry))
  const solid = shrink * shrink
  const whole = (part: PixelRect) => {
    const right = part.x + part.width - 1
    const bottom = part.y + part.height - 1
    return (
      field(part.x, part.y) <= solid &&
      field(right, part.y) <= solid &&
      field(part.x, bottom) <= solid &&
      field(right, bottom) <= solid
    )
  }
  return rasterise(
    size,
    snapped,
    (x, y) => {
      const nx = (x + 0.5 - cx) / rx
      const ny = (y + 0.5 - cy) / ry
      const gradient = 2 * Math.hypot(nx / rx, ny / ry)
      // At the exact centre the gradient vanishes, and the centre is inside.
      if (gradient === 0) return 255
      const distance = (field(x, y) - 1) / gradient
      return Math.round(Math.min(1, Math.max(0, 0.5 - distance)) * 255)
    },
    whole
  )
}

export function selectAll(size: Size): SelectionMask {
  return rectSelection(size, { x: 0, y: 0, ...size })!
}

/**
 * Everything the mask leaves out. Tiles swap between absent and full without
 * a texel being touched; only a soft or partial tile is rewritten.
 */
export function invertSelection(
  size: Size,
  mask: SelectionMask | null
): SelectionMask | null {
  if (!mask) return selectAll(size)
  const held = new Map(
    mask.tiles().map((tile) => [tileKey(tile.x, tile.y), tile])
  )
  const tiles = new Map<string, SelectionTile>()
  for (const coord of tilesCoveringRect({ x: 0, y: 0, ...size })) {
    const key = tileKey(coord.x, coord.y)
    const tile = held.get(key)
    if (!tile) {
      tiles.set(key, { ...coord, coverage: FULL_TILE, full: true })
      continue
    }
    if (tile.full) continue
    const coverage = new Uint8Array(TILE_TEXELS)
    for (let texel = 0; texel < TILE_TEXELS; texel++)
      coverage[texel] = 255 - tile.coverage[texel]
    const inverted = settle(coord, coverage, size)
    if (inverted) tiles.set(key, inverted)
  }
  return createSelection(size, tiles)
}

/**
 * The box a drag from `anchor` to `point` outlines. Constrained — Shift — it
 * is a square on the longer of the two sides, grown toward the pen, which is
 * what makes a circle out of the ellipse tool.
 */
export function dragRect(
  anchor: { x: number; y: number },
  point: { x: number; y: number },
  constrain: boolean
): PixelRect {
  let dx = point.x - anchor.x
  let dy = point.y - anchor.y
  if (constrain) {
    const side = Math.max(Math.abs(dx), Math.abs(dy))
    dx = dx < 0 ? -side : side
    dy = dy < 0 ? -side : side
  }
  return {
    x: Math.min(anchor.x, anchor.x + dx),
    y: Math.min(anchor.y, anchor.y + dy),
    width: Math.abs(dx),
    height: Math.abs(dy),
  }
}

/** Whether two selections cover exactly the same pixels. */
export function sameSelection(
  a: SelectionMask | null,
  b: SelectionMask | null
): boolean {
  if (a === b) return true
  if (!a || !b || a.tileCount() !== b.tileCount()) return false
  const { x, y, width, height } = a.bounds
  const other = b.bounds
  if (
    x !== other.x ||
    y !== other.y ||
    width !== other.width ||
    height !== other.height
  )
    return false
  const held = new Map(b.tiles().map((tile) => [tileKey(tile.x, tile.y), tile]))
  return a.tiles().every((tile) => {
    const match = held.get(tileKey(tile.x, tile.y))
    if (!match) return false
    if (match.coverage === tile.coverage) return true
    const visible = visiblePart(tile, a)!
    const originX = tile.x * TILE_SIZE
    const originY = tile.y * TILE_SIZE
    for (let row = visible.y; row < visible.y + visible.height; row++) {
      const start = (row - originY) * TILE_SIZE + visible.x - originX
      for (let texel = start; texel < start + visible.width; texel++)
        if (tile.coverage[texel] !== match.coverage[texel]) return false
    }
    return true
  })
}

export type Point = { x: number; y: number }

/**
 * The closed outline through `points`, last point joined back to the first
 * (09). A pixel is selected where its centre sits inside by the nonzero rule,
 * so a freehand loop that crosses back over itself stays filled. Edges are
 * hard: a lasso is drawn by hand, and a soft rim would only blur what the
 * hand meant.
 */
export function lassoSelection(
  size: Size,
  points: readonly Point[]
): SelectionMask | null {
  if (points.length < 3) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const { x, y } of points) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  const box = intersectRect(
    {
      x: Math.floor(minX),
      y: Math.floor(minY),
      width: Math.ceil(maxX) - Math.floor(minX),
      height: Math.ceil(maxY) - Math.floor(minY),
    },
    { x: 0, y: 0, ...size }
  )
  if (!box) return null

  const tiles = new Map<string, Uint8Array>()
  const crossings: { x: number; winding: number }[] = []
  for (let y = box.y; y < box.y + box.height; y++) {
    // Each row is cut where the outline crosses its pixel centres' line; the
    // spans between cuts with a nonzero winding are inside.
    const centre = y + 0.5
    crossings.length = 0
    for (let i = 0; i < points.length; i++) {
      const a = points[i]
      const b = points[(i + 1) % points.length]
      // Half-open in y, so a vertex on the line is counted once.
      if (a.y <= centre === b.y <= centre) continue
      const t = (centre - a.y) / (b.y - a.y)
      crossings.push({
        x: a.x + t * (b.x - a.x),
        winding: b.y > a.y ? 1 : -1,
      })
    }
    if (crossings.length === 0) continue
    crossings.sort((p, q) => p.x - q.x)
    const tileY = tileIndexForPixel(y)
    const row = (y - tileY * TILE_SIZE) * TILE_SIZE
    let winding = 0
    for (let i = 0; i < crossings.length - 1; i++) {
      winding += crossings[i].winding
      if (winding === 0) continue
      // Pixels whose centre lies in [left, right).
      const from = Math.max(box.x, Math.ceil(crossings[i].x - 0.5))
      const to = Math.min(
        box.x + box.width,
        Math.ceil(crossings[i + 1].x - 0.5)
      )
      for (let x = from; x < to;) {
        const tileX = tileIndexForPixel(x)
        const key = tileKey(tileX, tileY)
        let coverage = tiles.get(key)
        if (!coverage) {
          coverage = new Uint8Array(TILE_TEXELS)
          tiles.set(key, coverage)
        }
        const end = Math.min(to, (tileX + 1) * TILE_SIZE)
        const origin = row - tileX * TILE_SIZE
        coverage.fill(255, origin + x, origin + end)
        x = end
      }
    }
  }

  const settled = new Map<string, SelectionTile>()
  for (const [key, coverage] of tiles) {
    const [x, y] = key.split(",").map(Number)
    const tile = settle({ x, y }, coverage, size)
    if (tile) settled.set(key, tile)
  }
  return createSelection(size, settled)
}

/** How a new shape meets the selection already there (09). */
export type SelectionMode = "replace" | "add" | "subtract" | "intersect"

/**
 * The selection `mode` makes of `base` and a newly drawn `shape`, by
 * coverage: add keeps the greater, subtract what `shape` leaves of `base`,
 * intersect the lesser. Tiles only one side speaks for are carried over
 * as they are, and full tiles decide a pair without a texel being read.
 */
export function combineSelections(
  size: Size,
  base: SelectionMask | null,
  shape: SelectionMask | null,
  mode: SelectionMode
): SelectionMask | null {
  if (mode === "replace") return shape
  if (!base) return mode === "add" ? shape : null
  if (!shape) return mode === "intersect" ? null : base

  const own = new Map(shape.tiles().map((t) => [tileKey(t.x, t.y), t]))
  const tiles = new Map<string, SelectionTile>()
  const merge = (
    coord: TileCoord,
    a: Uint8Array,
    b: Uint8Array,
    pick: (a: number, b: number) => number
  ) => {
    const coverage = new Uint8Array(TILE_TEXELS)
    for (let texel = 0; texel < TILE_TEXELS; texel++)
      coverage[texel] = pick(a[texel], b[texel])
    return settle(coord, coverage, size)
  }
  for (const tile of base.tiles()) {
    const key = tileKey(tile.x, tile.y)
    const other = own.get(key)
    let next: SelectionTile | null
    if (mode === "add") {
      if (!other || tile.full) next = tile
      else if (other.full) next = other
      else next = merge(tile, tile.coverage, other.coverage, Math.max)
    } else if (mode === "subtract") {
      if (!other) next = tile
      else if (other.full) next = null
      else
        next = merge(tile, tile.coverage, other.coverage, (a, b) =>
          Math.min(a, 255 - b)
        )
    } else {
      if (!other) next = null
      else if (tile.full) next = other
      else if (other.full) next = tile
      else next = merge(tile, tile.coverage, other.coverage, Math.min)
    }
    if (next) tiles.set(key, next)
  }
  // Only a union reaches past the tiles the selection already held.
  if (mode === "add")
    for (const [key, tile] of own) if (!tiles.has(key)) tiles.set(key, tile)
  return createSelection(size, tiles)
}
