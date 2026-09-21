/**
 * Tile geometry. Pure value math: no GPU, no storage, no allocation policy.
 * The Worker migration, atlas eviction and compute brushes all leave this
 * untouched, which is why it is tested directly rather than through pixels.
 */

/** Tiles are 256x256 (D3). Storage, undo and upload granularity all follow it. */
export const TILE_SIZE = 256
export const TILE_CHANNELS = 4
export const TILE_TEXELS = TILE_SIZE * TILE_SIZE

export type TileCoord = Readonly<{ x: number; y: number }>

export type PixelRect = Readonly<{
  x: number
  y: number
  width: number
  height: number
}>

/** The grid origin is the canvas top-left, so tile indices are non-negative. */
export function tileIndexForPixel(pixel: number): number {
  return Math.floor(pixel / TILE_SIZE)
}

export function tileBounds(coord: TileCoord): PixelRect {
  return {
    x: coord.x * TILE_SIZE,
    y: coord.y * TILE_SIZE,
    width: TILE_SIZE,
    height: TILE_SIZE,
  }
}

export function tileKey(x: number, y: number): string {
  return `${x},${y}`
}

/** The coordinate a key was made from. */
export function tileCoordFromKey(key: string): TileCoord {
  const [x, y] = key.split(",").map(Number)
  return { x, y }
}

/** One tile of premultiplied rgba16float, which is what every tier charges. */
export const TILE_BYTES = TILE_TEXELS * TILE_CHANNELS * 2

export function isEmptyRect(rect: PixelRect): boolean {
  return rect.width <= 0 || rect.height <= 0
}

export function intersectRect(a: PixelRect, b: PixelRect): PixelRect | null {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.width, b.x + b.width)
  const bottom = Math.min(a.y + a.height, b.y + b.height)
  if (right <= x || bottom <= y) return null
  return { x, y, width: right - x, height: bottom - y }
}

/** Row-major order, so callers upload and composite tiles predictably. */
/** The smallest rectangle holding both: what a drag has covered altogether. */
export function unionRect(a: PixelRect, b: PixelRect): PixelRect {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  const right = Math.max(a.x + a.width, b.x + b.width)
  const bottom = Math.max(a.y + a.height, b.y + b.height)
  return { x, y, width: right - x, height: bottom - y }
}

export function tilesCoveringRect(rect: PixelRect): TileCoord[] {
  if (isEmptyRect(rect)) return []
  const minX = tileIndexForPixel(rect.x)
  const minY = tileIndexForPixel(rect.y)
  // The far edge is exclusive: a rect ending on a boundary stops short of it.
  const maxX = tileIndexForPixel(rect.x + rect.width - 1)
  const maxY = tileIndexForPixel(rect.y + rect.height - 1)
  const tiles: TileCoord[] = []
  for (let y = minY; y <= maxY; y++)
    for (let x = minX; x <= maxX; x++) tiles.push({ x, y })
  return tiles
}

export interface DirtyRegion {
  include(rect: PixelRect): void
  bounds(): PixelRect | null
  clear(): void
}

/**
 * A single growing bounding box. Deliberately coarse: what consumers need is
 * "which tiles must be re-uploaded", and tile granularity swallows the slack.
 */
export function createDirtyRegion(): DirtyRegion {
  let left = 0
  let top = 0
  let right = 0
  let bottom = 0
  let touched = false
  return {
    include(rect) {
      if (isEmptyRect(rect)) return
      if (!touched) {
        touched = true
        left = rect.x
        top = rect.y
        right = rect.x + rect.width
        bottom = rect.y + rect.height
        return
      }
      left = Math.min(left, rect.x)
      top = Math.min(top, rect.y)
      right = Math.max(right, rect.x + rect.width)
      bottom = Math.max(bottom, rect.y + rect.height)
    },
    bounds: () =>
      touched
        ? { x: left, y: top, width: right - left, height: bottom - top }
        : null,
    clear() {
      touched = false
    },
  }
}
