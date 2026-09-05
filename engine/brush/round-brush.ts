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

/** Premultiplied linear-light ink. Stroke opacity is applied at composite. */
export const BRUSH_COLOR: LinearColor = [INK[0], INK[1], INK[2], 1]

/**
 * How dabs within one stroke combine (D27).
 *
 * - `coverage` takes the maximum: a stroke that crosses itself reads as one
 *   flat mark, which is what a marker or an airbrush does.
 * - `buildup` accumulates: each dab adds, as wet and dry media do.
 */
export type Accumulation = "coverage" | "buildup"

/** Marker-like by default: the crossing of a stroke should not darken. */
export const BRUSH_ACCUMULATION: Accumulation = "coverage"

/**
 * Opacity of the whole stroke, applied once when the stroke buffer is
 * composited — never per dab, or a crossing would darken whatever the mode.
 */
export const BRUSH_OPACITY = 1

/**
 * Opacity of a single dab. Flow is what accumulation acts on: dabs at full
 * flow replace each other whichever mode is set, and it is only below one that
 * a buildup brush visibly darkens where a stroke crosses itself.
 */
export const BRUSH_FLOW = 1
