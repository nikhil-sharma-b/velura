/**
 * How raster pixels are drawn when the view magnifies them (sharp-zoom 03):
 * as hard-edged pixels once zoomed in past `PIXEL_MAGNIFICATION`, and
 * filtered below it, or always filtered. View state: what the screen shows,
 * never what export or thumbnails read.
 */
export const RASTER_MAGNIFICATIONS = ["pixels", "smooth"] as const
export type RasterMagnification = (typeof RASTER_MAGNIFICATIONS)[number]
export const DEFAULT_RASTER_MAGNIFICATION: RasterMagnification = "pixels"

/**
 * The zoom past which "pixels" shows each document pixel as a square. Below
 * it a pixel is too few screen pixels across for squares to read as anything
 * but jagged edges, so it is filtered either way.
 */
export const PIXEL_MAGNIFICATION = 2

/** Whether document pixels are fetched nearest at this zoom, in this mode. */
export function samplesNearest(
  mode: RasterMagnification,
  zoom: number
): boolean {
  return mode === "pixels" && zoom > PIXEL_MAGNIFICATION
}
