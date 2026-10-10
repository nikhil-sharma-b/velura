/**
 * The smudge tool's own settings (smudge 02): how big its dab is and how hard
 * it drags, kept apart from the brush, whose tip only lends the dab its shape.
 */
export type Smudge = Readonly<{
  /** Dab radius in canvas pixels. */
  radius: number
  /**
   * How much of the pixel one dab behind replaces the one under the tip, in
   * [0, 1]: low softens an edge, high drags paint a long way.
   */
  strength: number
}>

/**
 * Larger than the brush starts at, since smudging usually runs larger than
 * drawing, and a strength below one, so paint thins out as it is dragged
 * instead of travelling for ever.
 */
export const DEFAULT_SMUDGE: Smudge = Object.freeze({
  radius: 16,
  strength: 0.9,
})

/**
 * Distance between dabs in canvas pixels, a quarter of the dab's radius. With
 * the strength, this sets how far paint is carried: each dab hands on that
 * share of what the last one brought. Never under a pixel, where a dab would
 * have no whole pixel behind it to drag.
 */
export function smudgeSpacing(radius: number): number {
  return Math.max(1, radius / 4)
}

/**
 * One dab's strength. A pen's pressure drives it up to the setting and no
 * further, so a light touch softens and a hard press drags; a device with no
 * force sensor runs at the setting.
 */
export function smudgeDabStrength(
  strength: number,
  pressure: number,
  sensesPressure: boolean
): number {
  if (!sensesPressure) return strength
  return strength * Math.min(1, Math.max(0, pressure))
}

/** Whether a value is a size and strength the smudge tool can be set to. */
export function isSmudge(value: unknown): value is Smudge {
  if (typeof value !== "object" || value === null) return false
  const { radius, strength } = value as Record<string, unknown>
  return (
    typeof radius === "number" &&
    Number.isFinite(radius) &&
    radius > 0 &&
    typeof strength === "number" &&
    Number.isFinite(strength) &&
    strength >= 0 &&
    strength <= 1
  )
}
