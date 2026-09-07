import { decodeTransfer, srgbToWorking } from "../color/display-transform"
import type { LinearColor } from "../doc/tiled-layer"

/**
 * The defaults the round brush is built from, and the ink every stroke is
 * drawn in.
 *
 * A brush proper is data — see `brush.ts`, which assembles these into
 * `DEFAULT_BRUSH` — and what it does with pressure and tilt is the dynamics
 * graph's business (D23). These are only the numbers a brush starts at, kept
 * apart because the renderer needs the ink and the feather before any brush
 * has been chosen.
 */

/** Dab radius in canvas pixels. */
export const BRUSH_RADIUS = 6

/**
 * Stamp spacing as a fraction of the dab diameter. A quarter of the tip is the
 * usual default: dense enough that the stroke reads as continuous, sparse
 * enough that a frame's worth of stamps stays a small draw.
 */
export const BRUSH_SPACING_RATIO = 0.25

/** Softness of the dab edge, in pixels of falloff inside the rim. */
export const BRUSH_FEATHER = 1

const INK = srgbToWorking([
  decodeTransfer(36 / 255),
  decodeTransfer(37 / 255),
  decodeTransfer(38 / 255),
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
