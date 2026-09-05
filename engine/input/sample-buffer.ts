/**
 * A fixed-capacity ring of pointer samples. Events are captured at the pen's
 * full rate — a 240 Hz stylus reports several samples per frame (D26) — and
 * consumed once per animation frame, so the buffer is the seam between the
 * event rate and the frame rate.
 *
 * The storage is one Float32Array allocated up front: pushing and draining are
 * cursor arithmetic, because both sides of this run in the stroke path (D30).
 */

/** Floats per sample: x, y, pressure, tiltX, tiltY, time. */
const STRIDE = 6

/**
 * Everything the pen reported for one sample: position in canvas pixels,
 * force in [0, 1], tilt in degrees per axis, and the event's clock reading in
 * milliseconds. The dynamics graph (D23) derives speed and heading from the
 * last two, so the clock has to survive the crossing rather than being read
 * as "now" on the frame that happens to drain the sample.
 */
export type SampleSink = (
  x: number,
  y: number,
  pressure: number,
  tiltX: number,
  tiltY: number,
  time: number
) => void

export interface SampleBuffer {
  push(
    x: number,
    y: number,
    pressure: number,
    tiltX: number,
    tiltY: number,
    time: number
  ): void
  /** Hands every buffered sample to `consume` in arrival order, then empties. */
  drain(consume: SampleSink): void
  clear(): void
  size(): number
  capacity(): number
}

export function createSampleBuffer(capacity: number): SampleBuffer {
  if (!Number.isInteger(capacity) || capacity < 1)
    throw new Error("Sample buffer capacity must be a positive integer.")
  const samples = new Float32Array(capacity * STRIDE)
  let read = 0
  let count = 0

  return {
    push(x, y, pressure, tiltX, tiltY, time) {
      const slot = (read + count) % capacity
      const offset = slot * STRIDE
      samples[offset] = x
      samples[offset + 1] = y
      samples[offset + 2] = pressure
      samples[offset + 3] = tiltX
      samples[offset + 4] = tiltY
      samples[offset + 5] = time
      // A full buffer means a frame was missed entirely. Drop the oldest
      // sample rather than the newest: the pen's current position matters more
      // than where it was two frames ago.
      if (count === capacity) read = (read + 1) % capacity
      else count++
    },
    drain(consume) {
      // Read the count once: a sample arriving during the drain belongs to the
      // next frame, and consuming it here would let a busy pen starve the loop.
      const draining = count
      for (let i = 0; i < draining; i++) {
        const offset = ((read + i) % capacity) * STRIDE
        consume(
          samples[offset],
          samples[offset + 1],
          samples[offset + 2],
          samples[offset + 3],
          samples[offset + 4],
          samples[offset + 5]
        )
      }
      read = (read + draining) % capacity
      count -= draining
    },
    clear() {
      read = 0
      count = 0
    },
    size: () => count,
    capacity: () => capacity,
  }
}
