/**
 * Roughly where each surface's pixels are, so a thumbnail can show a layer's
 * work rather than the whole canvas with a speck of it in the middle.
 *
 * Kept from what the engine already knows as pixels arrive — the region a
 * stroke covered, the tiles a restore or an undo wrote — so nothing is read
 * back to find it (D30). It only grows: erasing does not shrink it, and a box
 * a little too large still frames the work.
 */

import { type PixelRect, type TileCoord, tileBounds } from "../doc/tile-grid"

export interface ContentBounds {
  grow(id: string, rect: PixelRect): void
  growTiles(id: string, tiles: Iterable<TileCoord>): void
  copy(from: string, to: string): void
  forget(id: string): void
  clear(): void
  get(id: string): PixelRect | undefined
  /** One box around every named surface that has any; undefined for none. */
  union(ids: Iterable<string>): PixelRect | undefined
}

function unite(a: PixelRect | undefined, b: PixelRect): PixelRect {
  if (!a) return b
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  }
}

export function createContentBounds(): ContentBounds {
  const boxes = new Map<string, PixelRect>()
  return {
    grow(id, rect) {
      boxes.set(id, unite(boxes.get(id), rect))
    },
    growTiles(id, tiles) {
      let box = boxes.get(id)
      for (const tile of tiles) box = unite(box, tileBounds(tile))
      if (box) boxes.set(id, box)
    },
    copy(from, to) {
      const box = boxes.get(from)
      if (box) boxes.set(to, box)
      else boxes.delete(to)
    },
    forget(id) {
      boxes.delete(id)
    },
    clear() {
      boxes.clear()
    },
    get: (id) => boxes.get(id),
    union(ids) {
      let box: PixelRect | undefined
      for (const id of ids) {
        const own = boxes.get(id)
        if (own) box = unite(box, own)
      }
      return box
    },
  }
}

/** One box around a set of tiles, each counted as its whole square. */
export function tileBox(tiles: readonly TileCoord[]): PixelRect {
  return tiles.map(tileBounds).reduce<PixelRect | undefined>(unite, undefined)!
}

/** The smallest region a thumbnail zooms to, in document pixels. */
const MIN_FRAME = 64

/**
 * The region a thumbnail shows for work at `rect`: a margin of a twentieth
 * of its longer side so the work does not touch the thumbnail's edge, grown
 * to a minimum so a single dab is not blown up to a blur, and kept inside
 * the canvas.
 */
export function frameContent(
  rect: PixelRect,
  canvas: { width: number; height: number }
): PixelRect {
  const margin = Math.ceil(Math.max(rect.width, rect.height) / 20)
  const grow = (start: number, length: number, limit: number) => {
    const size = Math.min(limit, Math.max(MIN_FRAME, length + margin * 2))
    const centred = Math.round(start + length / 2 - size / 2)
    return [Math.min(Math.max(0, centred), limit - size), size] as const
  }
  const [x, width] = grow(rect.x, rect.width, canvas.width)
  const [y, height] = grow(rect.y, rect.height, canvas.height)
  return { x, y, width, height }
}
