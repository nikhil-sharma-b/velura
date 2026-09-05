/**
 * Path geometry for the stroke pipeline: a Catmull-Rom spline through the
 * sampled points, walked and resampled at a fixed arc length (D25).
 *
 * Arc-length resampling is what makes stamp spacing independent of drawing
 * speed. A polyline through the raw samples would place stamps wherever the
 * pen happened to report, so a flick would gap and a slow drag would blob.
 *
 * Nothing here allocates after construction: control points live in a fixed
 * Float64Array and stamps leave through a callback as plain numbers, because
 * this runs inside the per-frame stroke path (D30).
 */

/** Receives each resampled stamp position, in canvas pixels. */
export type StampSink = (x: number, y: number) => void

/** How finely the spline is walked before distances are accumulated. */
const WALK_STEP = 1.5
const MIN_WALK_STEPS = 4
const MAX_WALK_STEPS = 256

export interface StrokeResampler {
  /** Starts a stroke, emitting the first stamp under the pen. */
  begin(x: number, y: number, emit: StampSink): void
  /**
   * Adds a sampled point. Catmull-Rom needs a point on each side of the
   * segment it draws, so this emits stamps for the segment *before* the one
   * just added — the drawn path trails the pen by one sample.
   */
  extend(x: number, y: number, emit: StampSink): void
  /** Ends the stroke, flushing the trailing segment up to the last sample. */
  end(emit: StampSink): void
}

export function createStrokeResampler(spacing: number): StrokeResampler {
  if (!(spacing > 0)) throw new Error("Stamp spacing must be positive.")
  // Four control points: the segment drawn is p1 -> p2, shaped by p0 and p3.
  const control = new Float64Array(8)
  // Distance walked since the last stamp, carried across segments so the
  // spacing never restarts at an input sample.
  let carry = 0
  let started = false

  function setControl(slot: number, x: number, y: number) {
    control[slot * 2] = x
    control[slot * 2 + 1] = y
  }

  function shift() {
    control.copyWithin(0, 2)
  }

  /** Uniform Catmull-Rom, tension 1/2, on one axis. */
  function interpolate(axis: number, t: number): number {
    const p0 = control[axis]
    const p1 = control[2 + axis]
    const p2 = control[4 + axis]
    const p3 = control[6 + axis]
    const t2 = t * t
    const t3 = t2 * t
    return (
      0.5 *
      (2 * p1 +
        (p2 - p0) * t +
        (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
        (3 * p1 - 3 * p2 + p3 - p0) * t3)
    )
  }

  /** Walks p1 -> p2, emitting a stamp every `spacing` pixels of arc length. */
  function walk(emit: StampSink) {
    const chord = Math.hypot(control[4] - control[2], control[5] - control[3])
    if (chord === 0) return
    const steps = Math.min(
      MAX_WALK_STEPS,
      Math.max(MIN_WALK_STEPS, Math.ceil(chord / WALK_STEP))
    )
    let previousX = control[2]
    let previousY = control[3]
    for (let step = 1; step <= steps; step++) {
      const t = step / steps
      const x = interpolate(0, t)
      const y = interpolate(1, t)
      let remaining = Math.hypot(x - previousX, y - previousY)
      while (remaining > 0 && carry + remaining >= spacing) {
        const advance = spacing - carry
        const fraction = advance / remaining
        previousX += (x - previousX) * fraction
        previousY += (y - previousY) * fraction
        emit(previousX, previousY)
        remaining -= advance
        carry = 0
      }
      carry += remaining
      previousX = x
      previousY = y
    }
  }

  return {
    begin(x, y, emit) {
      // A stroke with no history is its own neighbourhood: the spline starts
      // flat and gains shape as samples arrive.
      for (let slot = 0; slot < 3; slot++) setControl(slot, x, y)
      carry = 0
      started = true
      emit(x, y)
    },
    extend(x, y, emit) {
      if (!started) throw new Error("The stroke has not begun.")
      setControl(3, x, y)
      walk(emit)
      shift()
    },
    end(emit) {
      if (!started) return
      // The pen lifted, so the last sample is also its own outward neighbour.
      setControl(3, control[4], control[5])
      walk(emit)
      started = false
    },
  }
}
