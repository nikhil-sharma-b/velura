import type { PixelRect } from "../doc/tile-grid"

/**
 * The side of one chunk of sampled artwork (live brushes 21): what is
 * flattened at once when a stroke first reads there. Four tiles, so a
 * 512 px dab opens on four chunks at most and a small one on one.
 */
export const FREEZE_CHUNK = 1024

const NONE: PixelRect[] = []

/**
 * Which chunks of the document a stroke has frozen. A chunk is taken the
 * first time a dab reads any of it and never again, which is what keeps the
 * picture as it stood at pen-down: a dab reads at least where it writes, so
 * every chunk is taken before the stroke has changed it.
 */
export function createFreezeLedger(
  width: number,
  height: number,
  chunk = FREEZE_CHUNK
) {
  const across = Math.ceil(width / chunk)
  const taken = new Set<number>()
  return {
    /**
     * The chunks under a rectangle that are not yet taken, each as far as
     * the document goes, and takes them. Edges are exclusive on the right
     * and bottom.
     */
    take(
      left: number,
      top: number,
      right: number,
      bottom: number
    ): PixelRect[] {
      const x0 = Math.max(0, left)
      const y0 = Math.max(0, top)
      const x1 = Math.min(width, right)
      const y1 = Math.min(height, bottom)
      if (x1 <= x0 || y1 <= y0) return NONE
      let fresh = NONE
      const lastColumn = Math.floor((x1 - 1) / chunk)
      const lastRow = Math.floor((y1 - 1) / chunk)
      for (let row = Math.floor(y0 / chunk); row <= lastRow; row++)
        for (
          let column = Math.floor(x0 / chunk);
          column <= lastColumn;
          column++
        ) {
          const index = row * across + column
          if (taken.has(index)) continue
          taken.add(index)
          if (fresh === NONE) fresh = []
          const x = column * chunk
          const y = row * chunk
          fresh.push({
            x,
            y,
            width: Math.min(chunk, width - x),
            height: Math.min(chunk, height - y),
          })
        }
      return fresh
    },
  }
}
