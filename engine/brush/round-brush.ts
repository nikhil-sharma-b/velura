import { decodeTransfer, srgbToWorking } from "../color/display-transform"
import type { LinearColor } from "../doc/tiled-layer"

/**
 * The one brush that exists so far: a plain round dab at fixed size and
 * opacity. Expressiveness — pressure, tilt, tip textures, the dynamics graph
 * (D23, D24) — arrives in later tickets and reads these as its defaults.
 */

/** Dab radius in canvas pixels. */
export const BRUSH_RADIUS = 6

/**
 * Stamp spacing as a fraction of the dab diameter. A quarter of the tip is the
 * usual default: dense enough that the stroke reads as continuous, sparse
 * enough that a frame's worth of stamps stays a small draw.
 */
export const BRUSH_SPACING_RATIO = 0.25

export const BRUSH_SPACING = BRUSH_RADIUS * 2 * BRUSH_SPACING_RATIO

/** Softness of the dab edge, in pixels of falloff inside the rim. */
export const BRUSH_FEATHER = 1

const INK = srgbToWorking([
  decodeTransfer(244 / 255),
  decodeTransfer(244 / 255),
  decodeTransfer(245 / 255),
])

/** Premultiplied linear-light ink. Opaque, so overlapping dabs do not darken. */
export const BRUSH_COLOR: LinearColor = [INK[0], INK[1], INK[2], 1]
