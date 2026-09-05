import { STAMP_STRIDE } from "./stamp-instance"

/**
 * Every dab of the stroke in flight, in the order it was drawn.
 *
 * The stroke buffer cannot be rewound in place: under coverage accumulation a
 * dab is blended with `max`, which forgets what was underneath it. So undoing
 * the tail of a stroke — which is what discarding mispredicted stamps means
 * (D26) — is done by clearing the buffer and replaying the dabs that survive.
 *
 * Storage is one Float32Array allocated with the renderer. A stroke long
 * enough to outrun it keeps drawing and stops recording: the alternative is
 * growing the array mid-stroke, and no frame of drawing may allocate (D30).
 */
export interface StampLog {
  /** Records the first `count` dabs of `instances`, if there is room. */
  append(instances: Float32Array, count: number): void
  count(): number
  /** Forgets the last `count` dabs; more than were recorded empties the log. */
  discard(count: number): void
  /**
   * Hands the recorded dabs to `draw` in runs of at most `chunk`, as offsets
   * into the log's own storage: replaying copies nothing.
   */
  replay(
    chunk: number,
    draw: (instances: Float32Array, offset: number, count: number) => void
  ): void
  reset(): void
  /** Whether the log still holds the whole stroke, and so can replay it. */
  replayable(): boolean
}

export function createStampLog(capacity: number): StampLog {
  if (!Number.isInteger(capacity) || capacity < 1)
    throw new Error("Stamp log capacity must be a positive integer.")
  const stamps = new Float32Array(capacity * STAMP_STRIDE)
  let count = 0
  let complete = true

  return {
    append(instances, appended) {
      const room = Math.min(appended, capacity - count)
      if (room < appended) complete = false
      if (room <= 0) return
      stamps.set(
        instances.subarray(0, room * STAMP_STRIDE),
        count * STAMP_STRIDE
      )
      count += room
    },
    count: () => count,
    discard(discarded) {
      count = Math.max(0, count - discarded)
    },
    replay(chunk, draw) {
      for (let offset = 0; offset < count; offset += chunk)
        draw(stamps, offset, Math.min(chunk, count - offset))
    },
    reset() {
      count = 0
      complete = true
    },
    replayable: () => complete,
  }
}
