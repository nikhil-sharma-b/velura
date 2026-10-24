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
import type { SelectionMask } from "./selection"
import {
  TILE_CHANNELS,
  TILE_SIZE,
  type PixelRect,
  type TileCoord,
  tileKey,
} from "./tile-grid"

/** A tile of a layer as read back: premultiplied half-float RGBA texels. */
export type TileTexels = TileCoord & { texels: Uint16Array }

/**
 * Whether the pixel at `at` holds anything. Texels are premultiplied half
 * floats, so alpha alone says so, and an alpha of zero is zero whichever its
 * sign bit.
 */
function holdsCoverage(texels: Uint16Array, at: number): boolean {
  return (texels[at * TILE_CHANNELS + 3]! & 0x7fff) !== 0
}

/** The smallest box holding every pixel with any coverage, or null for none. */
export function coveredBounds(tiles: readonly TileTexels[]): PixelRect | null {
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  for (const { x: column, y: row, texels } of tiles) {
    const originX = column * TILE_SIZE
    const originY = row * TILE_SIZE
    for (let y = 0; y < TILE_SIZE; y++)
      for (let x = 0; x < TILE_SIZE; x++) {
        if (!holdsCoverage(texels, y * TILE_SIZE + x)) continue
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
 * Whether lifting `mask` out of these tiles would pick up anything: some
 * pixel holding coverage that the selection also covers. Read from the
 * pixels themselves, so what the layer held once — or a box grown round
 * where a cancelled transform previewed — does not count (14). Only pixels
 * on the canvas count: an edge tile's overhang holds nothing anyone can see,
 * and the mask says nothing true there.
 */
export function liftsAnything(
  tiles: readonly TileTexels[],
  mask: SelectionMask
): boolean {
  const selected = new Map(
    mask.tiles().map((tile) => [tileKey(tile.x, tile.y), tile])
  )
  for (const { x: column, y: row, texels } of tiles) {
    const tile = selected.get(tileKey(column, row))
    if (!tile) continue
    const width = Math.min(TILE_SIZE, mask.width - column * TILE_SIZE)
    const height = Math.min(TILE_SIZE, mask.height - row * TILE_SIZE)
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const at = y * TILE_SIZE + x
        if (tile.coverage[at] !== 0 && holdsCoverage(texels, at)) return true
      }
  }
  return false
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
