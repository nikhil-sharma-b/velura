import { type Curve, type CurvePoint, sampleCurve } from "../brush/curve"

/**
 * The global pen response curve: what the device's force reading means before
 * any brush sees it.
 *
 * This sits at the input boundary rather than in the dynamics graph (D23) on
 * purpose. A brush's own curves describe the medium — that a pencil leaves
 * more graphite when pressed — and they should read the same on every device
 * and in every hand. What differs between one artist and the next is how hard
 * they press for what they consider a full stroke, and that is a property of
 * the pen and the hand, not of the pencil. Normalising it once here is what
 * keeps a brush shared between two artists behaving like the same brush.
 *
 * The curve lives in the engine, not the widget that edits it, because the
 * engine may not import the UI (D35) and the two must not drift: the widget
 * draws exactly the curve sampled here.
 */

/**
 * Slider positions from "Light" to "Heavy": the midpoint of the curve each
 * one generates. A midpoint above 0.5 bows the curve up, so a light touch
 * reaches a stronger output — which is what a light-handed artist wants.
 */
const PRESET_MIDPOINTS = Object.freeze([0.8, 0.65, 0.5, 0.35])

/** How many presets the slider offers, so a control need not guess. */
export const PRESSURE_PRESET_COUNT = PRESET_MIDPOINTS.length

/** The preset a fresh install starts on. */
export const DEFAULT_PRESSURE_PRESET = 1

/**
 * The curve at one slider position; out-of-range positions are linear.
 *
 * Returns a fresh mutable list, because the editor drags its points: a frozen
 * preset would be a preset the artist cannot then adjust.
 */
export function pressureCurvePreset(position: number): CurvePoint[] {
  const mid = PRESET_MIDPOINTS[position] ?? 0.5
  return [
    { x: 0, y: 0 },
    { x: 0.5, y: mid },
    { x: 1, y: 1 },
  ]
}

export const DEFAULT_PRESSURE_CURVE: Curve = Object.freeze(
  pressureCurvePreset(DEFAULT_PRESSURE_PRESET).map((point) =>
    Object.freeze(point)
  )
)

/**
 * A device reading, shaped by the artist's curve.
 *
 * Zero is passed through untouched whatever the curve says: a pen that
 * genuinely reports no force as it lands has to keep its zero, or the taper a
 * pressure mapping draws is inverted at both ends.
 */
export function shapePressure(curve: Curve, pressure: number): number {
  if (!(pressure > 0)) return 0
  return sampleCurve(curve, pressure > 1 ? 1 : pressure)
}

/**
 * Rejects a curve that is not a function of its input.
 *
 * The curve arrives from settings the artist edited, so it is input rather
 * than code the engine wrote, and it is sampled once per pointer sample —
 * checking it here is what lets that path stay branch-free.
 */
export function validatePressureCurve(curve: Curve): void {
  if (!Array.isArray(curve) || curve.length < 2)
    throw new Error("A pressure curve needs at least two points.")
  for (const [index, point] of curve.entries()) {
    if (
      !Number.isFinite(point?.x) ||
      !Number.isFinite(point?.y) ||
      point.x < 0 ||
      point.x > 1 ||
      point.y < 0 ||
      point.y > 1
    )
      throw new Error("Pressure curve points must lie in the unit square.")
    if (index > 0 && point.x <= curve[index - 1].x)
      throw new Error("Pressure curve points must increase along x.")
  }
}
