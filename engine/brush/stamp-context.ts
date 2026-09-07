import { clamp01 } from "./curve"
import type { StampContext } from "./dynamics"

/**
 * The boundary between what a pointer reports and what the dynamics graph
 * reads (D23).
 *
 * Devices speak in their own units — force in [0, 1], tilt in degrees per
 * axis, positions and clock readings — and some sources are not reported at
 * all but derived from how a dab follows the one before it. This normalises
 * all of it to [0, 1] in one place, so a curve authored against `velocity`
 * means the same thing whatever drew the stroke.
 *
 * A tracker holds one stroke and writes into a single context object it owns:
 * the caller reads it before the next dab, and the stroke path allocates
 * nothing (D30).
 */

/**
 * The length of stroke, in canvas pixels, that `strokeProgress` measures
 * against. Progress cannot be a fraction of the whole stroke while the stroke
 * is still being drawn — its length is not known until the pen lifts — so it
 * is a fraction of a nominal run instead, which is what a taper needs anyway.
 */
export const STROKE_PROGRESS_LENGTH = 240

/**
 * The speed, in canvas pixels per millisecond, that reads as full `velocity`.
 * A brisk stroke on a laptop trackpad sits near it; a flick saturates.
 */
export const REFERENCE_SPEED = 3

const TAU = Math.PI * 2
const DEGREES = Math.PI / 180

/** Keeps `tan` finite for a pen reported as lying exactly flat. */
const MAX_TILT_DEGREES = 89.9

/**
 * The same limit read from the other end: an altitude this close to the
 * surface is as flat as a pen is allowed to be, which keeps `tan` off zero
 * and the division below finite.
 */
const MIN_ALTITUDE_RADIANS = (90 - MAX_TILT_DEGREES) * (Math.PI / 180)

export interface StampContextTracker {
  /** Opens a stroke at the first dab. `seed` makes `random` reproducible. */
  begin(
    x: number,
    y: number,
    pressure: number,
    tiltX: number,
    tiltY: number,
    time: number,
    seed?: number
  ): StampContext
  /** Advances to the next dab and returns the context it is drawn with. */
  next(
    x: number,
    y: number,
    pressure: number,
    tiltX: number,
    tiltY: number,
    time: number
  ): StampContext
}

/** A turn in [0, 1) clockwise from +x, from an angle in radians. */
function turn(radians: number): number {
  const wrapped = radians / TAU
  return wrapped - Math.floor(wrapped)
}

/**
 * Pen tilt, from the two axis angles the Pointer Events spec reports, as
 * `[fromVertical, direction]` — both in [0, 1]. The composition is the spec's
 * own: the tangents of the axis tilts are the horizontal components of a unit
 * vector along the pen, so their length gives the angle from vertical and
 * their ratio gives the way it leans.
 */
export function normalizeTilt(
  tiltX: number,
  tiltY: number
): readonly [number, number] {
  const x = Math.tan(
    Math.max(-MAX_TILT_DEGREES, Math.min(MAX_TILT_DEGREES, tiltX || 0)) *
      DEGREES
  )
  const y = Math.tan(
    Math.max(-MAX_TILT_DEGREES, Math.min(MAX_TILT_DEGREES, tiltY || 0)) *
      DEGREES
  )
  const lean = Math.hypot(x, y)
  // Upright is 0 and flat is 1, so a curve's horizontal axis reads as "how
  // far over is the pen" rather than as an altitude counting the other way.
  const fromVertical = clamp01(Math.atan(lean) / (Math.PI / 2))
  return [fromVertical, lean === 0 ? 0 : turn(Math.atan2(y, x))]
}

/**
 * The axis tilts a pen's altitude and azimuth describe, in degrees.
 *
 * Pointer Events reports orientation two ways, and a device need only give
 * one: `tiltX`/`tiltY` as a pair of axis angles, or `altitudeAngle` and
 * `azimuthAngle` as a spherical direction. WebKit prefers the spherical pair
 * for Apple Pencil, so a canvas that reads only the axis angles would take an
 * iPad's pen as permanently upright and never shade with it.
 *
 * The conversion is the spec's own, and it is the exact inverse of what
 * `normalizeTilt` then undoes: the tangents of the axis angles are the
 * horizontal components of a unit vector along the pen, and those are
 * `cos(azimuth)` and `sin(azimuth)` over `tan(altitude)`.
 */
export function tiltFromAltitude(
  altitudeAngle: number,
  azimuthAngle: number
): readonly [number, number] {
  // The spec's own default is upright, and it is what a missing or unreadable
  // reading has to fall back to: taking it as zero would read as a pen lying
  // flat on the glass, which is the loudest possible answer to a device that
  // said nothing.
  const reported = Number.isFinite(altitudeAngle) ? altitudeAngle : Math.PI / 2
  const altitude = Math.max(
    MIN_ALTITUDE_RADIANS,
    Math.min(Math.PI / 2, reported)
  )
  const lean = 1 / Math.tan(altitude)
  const azimuth = Number.isFinite(azimuthAngle) ? azimuthAngle : 0
  return [
    Math.atan(Math.cos(azimuth) * lean) / DEGREES,
    Math.atan(Math.sin(azimuth) * lean) / DEGREES,
  ]
}

/** Mulberry32: small, fast, and seeded, so a stroke's jitter is repeatable. */
function createRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function createStampContextTracker(): StampContextTracker {
  const context: StampContext = {
    pressure: 1,
    tilt: 0,
    tiltDirection: 0,
    velocity: 0,
    direction: 0,
    random: 0,
    strokeProgress: 0,
  }
  let random = createRandom(1)
  let previousX = 0
  let previousY = 0
  let previousTime = 0
  let travelled = 0

  function write(pressure: number, tiltX: number, tiltY: number) {
    // Taken as reported: whether the device has a force sensor at all is a
    // fact about the device, settled once at the sampler, and a pen really
    // does report near zero as it lands and lifts.
    context.pressure = clamp01(pressure)
    const [tilt, direction] = normalizeTilt(tiltX, tiltY)
    context.tilt = tilt
    context.tiltDirection = direction
    context.random = random()
    context.strokeProgress = clamp01(travelled / STROKE_PROGRESS_LENGTH)
  }

  return {
    begin(x, y, pressure, tiltX, tiltY, time, seed = 1) {
      random = createRandom(seed)
      previousX = x
      previousY = y
      previousTime = time
      travelled = 0
      // Nothing has moved yet, so the first dab has no speed and no heading;
      // a direction mapping picks one up from the second dab onward.
      context.velocity = 0
      context.direction = 0
      write(pressure, tiltX, tiltY)
      return context
    },
    next(x, y, pressure, tiltX, tiltY, time) {
      const dx = x - previousX
      const dy = y - previousY
      const distance = Math.hypot(dx, dy)
      const elapsed = time - previousTime
      travelled += distance
      // Two dabs at one instant say nothing about speed — that happens when a
      // segment's samples share a clock reading — so the last speed stands.
      if (elapsed > 0)
        context.velocity = clamp01(distance / elapsed / REFERENCE_SPEED)
      if (distance > 0) context.direction = turn(Math.atan2(dy, dx))
      previousX = x
      previousY = y
      previousTime = time
      write(pressure, tiltX, tiltY)
      return context
    },
  }
}
