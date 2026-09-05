/**
 * The pulled-string stabilizer (D25). The pen drags an anchor on a string of
 * fixed length: the anchor only moves once the pen pulls the string taut, so
 * tremor inside the radius never reaches the path, while a deliberate movement
 * drags the anchor along behind the pen.
 *
 * This is the cheapest smoother that degrades honestly: at strength zero the
 * string has no length and the anchor sits exactly on the pen, so the raw
 * unfiltered path is restored rather than approximated.
 */

export type StabilizedPoint = { x: number; y: number }

/** String length at full strength, in canvas pixels. */
export const MAX_STABILIZER_PULL = 48

export interface Stabilizer {
  /** Strength in [0, 1]; zero is a true passthrough. */
  setStrength(strength: number): void
  strength(): number
  /** Anchors a new stroke under the pen. */
  begin(x: number, y: number): void
  /**
   * Filters one sample. The returned point is reused across calls so the
   * per-frame path allocates nothing — copy it if you need to retain it.
   */
  filter(x: number, y: number): StabilizedPoint
}

export function createStabilizer(): Stabilizer {
  const anchor: StabilizedPoint = { x: 0, y: 0 }
  // Held as the authored strength, not as the derived radius: reporting it
  // back through a division would return a value the caller never set.
  let strength = 0

  return {
    setStrength(next) {
      strength = Number.isFinite(next) ? Math.min(1, Math.max(0, next)) : 0
    },
    strength: () => strength,
    begin(x, y) {
      anchor.x = x
      anchor.y = y
    },
    filter(x, y) {
      const dx = x - anchor.x
      const dy = y - anchor.y
      const distance = Math.hypot(dx, dy)
      const pull = strength * MAX_STABILIZER_PULL
      // Inside the string's reach the anchor does not move at all: that gap is
      // exactly the tremor the artist wants removed.
      if (distance > pull) {
        const kept = pull / distance
        anchor.x = x - dx * kept
        anchor.y = y - dy * kept
      }
      return anchor
    },
  }
}
