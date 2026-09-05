/**
 * A fixed-capacity ring of pointer samples. Events are captured at the pen's
 * full rate — a 240 Hz stylus reports several samples per frame (D26) — and
 * consumed once per animation frame, so the buffer is the seam between the
 * event rate and the frame rate.
 *
 * The storage is one Float32Array allocated up front: pushing and draining are
 * cursor arithmetic, because both sides of this run in the stroke path (D30).
 */

const STRIDE = 3

export type SampleSink = (x: number, y: number, pressure: number) => void

export interface SampleBuffer {
  push(x: number, y: number, pressure: number): void
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
    push(x, y, pressure) {
      const slot = (read + count) % capacity
      const offset = slot * STRIDE
      samples[offset] = x
      samples[offset + 1] = y
      samples[offset + 2] = pressure
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
        consume(samples[offset], samples[offset + 1], samples[offset + 2])
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
