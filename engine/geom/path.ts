/**
 * Path geometry for the stroke pipeline: a Catmull-Rom spline through the
 * sampled points, walked and resampled at a fixed arc length (D25).
 *
 * Arc-length resampling is what makes stamp spacing independent of drawing
 * speed. A polyline through the raw samples would place stamps wherever the
 * pen happened to report, so a flick would gap and a slow drag would blob.
 *
 * Each sample carries what the pen reported with it — force, tilt, the clock —
 * and those ride along the spline, interpolated to wherever a stamp actually
 * lands. Holding a sample's pressure for every stamp of its segment instead
 * would step the width of a stroke at the input rate, which is visible as
 * banding on a slow press.
 *
 * Nothing here allocates after construction: control points live in a fixed
 * Float64Array and stamps leave through a callback as plain numbers, because
 * this runs inside the per-frame stroke path (D30).
 */

/**
 * Receives each resampled stamp: position in canvas pixels, and the pen state
 * interpolated to it — force in [0, 1], tilt in degrees per axis, and the
 * clock reading in milliseconds.
 *
 * A sink that draws a dab whose size the dynamics graph decided calls
 * `setSpacing` while it runs, since spacing is a fraction of that dab's
 * diameter. Its own return value is ignored.
 */
export type StampSink = (
  x: number,
  y: number,
  pressure: number,
  tiltX: number,
  tiltY: number,
  time: number
) => unknown

/** How finely the spline is walked before distances are accumulated. */
const WALK_STEP = 1.5
const MIN_WALK_STEPS = 4
const MAX_WALK_STEPS = 256

/** Floats per control point: x, y, pressure, tiltX, tiltY, time. */
const STRIDE = 6
/** Where the interpolated attributes start within a control point. */
const ATTRIBUTES = 2

export interface StrokeResampler {
  /** Starts a stroke, emitting the first stamp under the pen. */
  begin(
    x: number,
    y: number,
    pressure: number,
    tiltX: number,
    tiltY: number,
    time: number,
    emit: StampSink
  ): void
  /**
   * Adds a sampled point. Catmull-Rom needs a point on each side of the
   * segment it draws, so this emits stamps for the segment *before* the one
   * just added — the drawn path trails the pen by one sample.
   */
  extend(
    x: number,
    y: number,
    pressure: number,
    tiltX: number,
    tiltY: number,
    time: number,
    emit: StampSink
  ): void
  /** Ends the stroke, flushing the trailing segment up to the last sample. */
  end(emit: StampSink): void
  /**
   * Sets the distance to the next stamp, in canvas pixels.
   *
   * Called from inside a `StampSink`, by a caller that has just decided how
   * big the dab it is drawing is. It is a method rather than the sink's
   * return value because a sink returns whatever its last expression happened
   * to be — `array.push` answers with a length — and a spacing set by
   * accident is a stroke that silently changes tone.
   */
  setSpacing(pixels: number): void
}

export function createStrokeResampler(baseSpacing: number): StrokeResampler {
  if (!(baseSpacing > 0)) throw new Error("Stamp spacing must be positive.")
  // The brush at rest opens every stroke, because the first dab's size is not
  // known until it has been placed. Each dab then says what follows it, so a
  // brush that grows with tilt or pressure lays down the same number of dabs
  // per dab-width whatever size it is drawing at — which is what keeps a
  // buildup brush from darkening simply because it got bigger.
  let spacing = baseSpacing
  // Four control points: the segment drawn is p1 -> p2, shaped by p0 and p3.
  const control = new Float64Array(4 * STRIDE)
  // Distance walked since the last stamp, carried across segments so the
  // spacing never restarts at an input sample.
  let carry = 0
  let started = false

  function setControl(
    slot: number,
    x: number,
    y: number,
    pressure: number,
    tiltX: number,
    tiltY: number,
    time: number
  ) {
    const offset = slot * STRIDE
    control[offset] = x
    control[offset + 1] = y
    control[offset + 2] = pressure
    control[offset + 3] = tiltX
    control[offset + 4] = tiltY
    control[offset + 5] = time
  }

  function copyControl(target: number, source: number) {
    control.copyWithin(target * STRIDE, source * STRIDE, (source + 1) * STRIDE)
  }

  function shift() {
    control.copyWithin(0, STRIDE)
  }

  /** Uniform Catmull-Rom, tension 1/2, on one axis. */
  function interpolate(axis: number, t: number): number {
    const p0 = control[axis]
    const p1 = control[STRIDE + axis]
    const p2 = control[2 * STRIDE + axis]
    const p3 = control[3 * STRIDE + axis]
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

  /**
   * Pen state at parameter `t` along p1 -> p2. Linear, not splined: pressure
   * and the clock have no curvature to preserve, and a spline through them
   * would overshoot past what the pen ever reported.
   */
  function attribute(index: number, t: number): number {
    const a = control[STRIDE + ATTRIBUTES + index]
    const b = control[2 * STRIDE + ATTRIBUTES + index]
    return a + (b - a) * t
  }

  function emitAt(x: number, y: number, t: number, emit: StampSink) {
    emit(
      x,
      y,
      attribute(0, t),
      attribute(1, t),
      attribute(2, t),
      attribute(3, t)
    )
  }

  /**
   * Walks p1 -> p2, emitting a stamp every `spacing` pixels of arc length.
   * The spacing is re-read each time round, since the stamp just emitted may
   * have changed it.
   */
  function walk(emit: StampSink) {
    const chord = Math.hypot(
      control[2 * STRIDE] - control[STRIDE],
      control[2 * STRIDE + 1] - control[STRIDE + 1]
    )
    if (chord === 0) return
    const steps = Math.min(
      MAX_WALK_STEPS,
      Math.max(MIN_WALK_STEPS, Math.ceil(chord / WALK_STEP))
    )
    let previousX = control[STRIDE]
    let previousY = control[STRIDE + 1]
    for (let step = 1; step <= steps; step++) {
      const t = step / steps
      const previousT = (step - 1) / steps
      const x = interpolate(0, t)
      const y = interpolate(1, t)
      let remaining = Math.hypot(x - previousX, y - previousY)
      // How far along this walk step the last stamp fell, so a stamp between
      // two steps reads the pen state at the point it actually landed.
      let walked = 0
      while (remaining > 0 && carry + remaining >= spacing) {
        // A dab that shrinks the spacing can leave more already walked than
        // the new spacing asks for. That stamp lands here rather than behind
        // the pen, and the next one picks up the spacing properly.
        const advance = Math.max(0, spacing - carry)
        const fraction = advance / remaining
        previousX += (x - previousX) * fraction
        previousY += (y - previousY) * fraction
        walked += (1 - walked) * fraction
        emitAt(previousX, previousY, previousT + walked / steps, emit)
        remaining -= advance
        carry = 0
      }
      carry += remaining
      previousX = x
      previousY = y
    }
  }

  return {
    begin(x, y, pressure, tiltX, tiltY, time, emit) {
      // A stroke with no history is its own neighbourhood: the spline starts
      // flat and gains shape as samples arrive.
      for (let slot = 0; slot < 3; slot++)
        setControl(slot, x, y, pressure, tiltX, tiltY, time)
      carry = 0
      spacing = baseSpacing
      started = true
      emit(x, y, pressure, tiltX, tiltY, time)
    },
    extend(x, y, pressure, tiltX, tiltY, time, emit) {
      if (!started) throw new Error("The stroke has not begun.")
      setControl(3, x, y, pressure, tiltX, tiltY, time)
      walk(emit)
      shift()
    },
    setSpacing(pixels) {
      // An unusable answer leaves the spacing where it is: a stroke drawn at
      // NaN or at infinity is a stroke that stops dead.
      if (Number.isFinite(pixels) && pixels > 0) spacing = pixels
    },
    end(emit) {
      if (!started) return
      // The pen lifted, so the last sample is also its own outward neighbour.
      copyControl(3, 2)
      walk(emit)
      started = false
    },
  }
}
