/**
 * What picking up a painted layer to move, scale, turn or mirror it (13)
 * needs beyond what a placed image already has.
 *
 * A painted layer has no original file, so its source is a snapshot of its
 * own pixels taken as it is picked up — the tight box round them, so the
 * handles sit on the work rather than on the tiles it happens to touch.
 * From there it is a placement like any other, and the shared session (12)
 * previews every adjustment from that snapshot and resamples it once.
 *
 * Pure value math: no GPU, no document.
 */

import type { ImagePlacement } from "./image-placement"
import {
  TILE_CHANNELS,
  TILE_SIZE,
  type PixelRect,
  type TileCoord,
} from "./tile-grid"

/**
 * The smallest box holding every pixel with any coverage, or null for none.
 * Texels are premultiplied half floats, so alpha alone says whether a pixel
 * holds anything.
 */
export function coveredBounds(
  tiles: readonly (TileCoord & { texels: Uint16Array })[]
): PixelRect | null {
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  for (const { x: column, y: row, texels } of tiles) {
    const originX = column * TILE_SIZE
    const originY = row * TILE_SIZE
    for (let y = 0; y < TILE_SIZE; y++)
      for (let x = 0; x < TILE_SIZE; x++) {
        // Either zero, positive or negative, has no coverage.
        if ((texels[(y * TILE_SIZE + x) * TILE_CHANNELS + 3]! & 0x7fff) === 0)
          continue
        left = Math.min(left, originX + x)
        top = Math.min(top, originY + y)
        right = Math.max(right, originX + x + 1)
        bottom = Math.max(bottom, originY + y + 1)
      }
  }
  if (left === Infinity) return null
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/**
 * The layer as picked up: its content box, untouched. The source is that box
 * too, so this placement draws the snapshot exactly where it came from.
 */
export function layerStartPlacement(region: PixelRect): ImagePlacement {
  return {
    x: region.x + region.width / 2,
    y: region.y + region.height / 2,
    width: region.width,
    height: region.height,
    rotation: 0,
    flipX: false,
    flipY: false,
  }
}
