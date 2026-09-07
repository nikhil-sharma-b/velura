import { decodeTransfer, srgbToWorking } from "../color/display-transform"
import { encodeFloat16 } from "./float16"
import {
  intersectRect,
  type PixelRect,
  TILE_CHANNELS,
  TILE_SIZE,
  TILE_TEXELS,
  type TileCoord,
  tileBounds,
  tilesCoveringRect,
} from "./tile-grid"

/** An image as a browser hands one over: non-premultiplied sRGB, 8 bits. */
export type SourceImage = {
  readonly width: number
  readonly height: number
  /** Row-major RGBA, four bytes a pixel — an `ImageData.data`. */
  readonly pixels: Uint8ClampedArray | Uint8Array
}

/**
 * A placed image as the document stores pixels: whole 256x256 tiles of
 * premultiplied linear-light rgba16float, in the working space (D3, D10).
 *
 * The conversion happens here, at the boundary, for the same reason a brush
 * tip is reduced to coverage at its own: everything downstream — the GPU
 * surfaces, the tile store, undo, the manifest — speaks one pixel format, and
 * a photograph that arrived as sRGB bytes must not be the one thing in the
 * document that carries its own encoding around with it.
 *
 * Only touched tiles are produced, so a small logo dropped on an 8192 canvas
 * costs the tiles it covers rather than the canvas.
 */
export function imageTiles(
  image: SourceImage,
  origin: { x: number; y: number },
  canvas: { width: number; height: number }
): (TileCoord & { texels: Uint16Array })[] {
  const placed: PixelRect = {
    x: Math.round(origin.x),
    y: Math.round(origin.y),
    width: image.width,
    height: image.height,
  }
  // The part of the image that lands on the canvas. What hangs off the edge is
  // not stored: a tile outside the document reads back as zero anyway, so
  // keeping it would only put pixels in the manifest that nothing can show.
  const visible = intersectRect(placed, {
    x: 0,
    y: 0,
    width: canvas.width,
    height: canvas.height,
  })
  if (!visible) return []

  const tiles: (TileCoord & { texels: Uint16Array })[] = []
  for (const coord of tilesCoveringRect(visible)) {
    const span = intersectRect(visible, tileBounds(coord))
    if (!span) continue
    const tile = {
      x: coord.x,
      y: coord.y,
      texels: new Uint16Array(TILE_TEXELS * TILE_CHANNELS),
    }
    tiles.push(tile)
    for (let y = span.y; y < span.y + span.height; y++) {
      const sourceRow = (y - placed.y) * image.width
      const tileRow = (y - coord.y * TILE_SIZE) * TILE_SIZE
      for (let x = span.x; x < span.x + span.width; x++) {
        const from = (sourceRow + (x - placed.x)) * 4
        const alpha = image.pixels[from + 3] / 255
        const [red, green, blue] = srgbToWorking([
          decodeTransfer(image.pixels[from] / 255),
          decodeTransfer(image.pixels[from + 1] / 255),
          decodeTransfer(image.pixels[from + 2] / 255),
        ])
        const at = (tileRow + (x - coord.x * TILE_SIZE)) * TILE_CHANNELS
        tile.texels[at] = encodeFloat16(red * alpha)
        tile.texels[at + 1] = encodeFloat16(green * alpha)
        tile.texels[at + 2] = encodeFloat16(blue * alpha)
        tile.texels[at + 3] = encodeFloat16(alpha)
      }
    }
  }
  return tiles
}

/**
 * Where an image goes when nothing else is asked for: centred, and scaled down
 * to fit the canvas if it is larger than one. Scaling up is not the same
 * favour — an image smaller than the canvas is placed at its own resolution
 * rather than blown up to fill a document it was never meant to.
 */
export function fitPlacement(
  image: { width: number; height: number },
  canvas: { width: number; height: number }
): PixelRect {
  const scale = Math.min(
    1,
    canvas.width / image.width,
    canvas.height / image.height
  )
  const width = Math.max(1, Math.round(image.width * scale))
  const height = Math.max(1, Math.round(image.height * scale))
  return {
    x: Math.round((canvas.width - width) / 2),
    y: Math.round((canvas.height - height) / 2),
    width,
    height,
  }
}
