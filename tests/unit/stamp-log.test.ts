import { describe, expect, test } from "bun:test"
import { STAMP_STRIDE } from "../../engine/gpu/stamp-instance"
import { createStampLog } from "../../engine/gpu/stamp-log"

/** Builds `count` stamps whose centre x is the sequence given. */
function stamps(...xs: number[]): Float32Array {
  const data = new Float32Array(xs.length * STAMP_STRIDE)
  xs.forEach((x, i) => {
    data[i * STAMP_STRIDE] = x
  })
  return data
}

function replayed(
  log: ReturnType<typeof createStampLog>,
  chunk = 64
): number[][] {
  const chunks: number[][] = []
  log.replay(chunk, (data, offset, count) => {
    const xs: number[] = []
    for (let i = 0; i < count; i++) xs.push(data[(offset + i) * STAMP_STRIDE])
    chunks.push(xs)
  })
  return chunks
}

describe("stroke stamp log", () => {
  test("replays every recorded stamp in order", () => {
    const log = createStampLog(8)
    log.append(stamps(1, 2), 2)
    log.append(stamps(3), 1)
    expect(log.count()).toBe(3)
    expect(replayed(log)).toEqual([[1, 2, 3]])
  })

  test("replays in draw-sized chunks so the instance buffer is never overrun", () => {
    const log = createStampLog(8)
    log.append(stamps(1, 2, 3, 4, 5), 5)
    expect(replayed(log, 2)).toEqual([[1, 2], [3, 4], [5]])
  })

  test("discards the most recently added stamps", () => {
    const log = createStampLog(8)
    log.append(stamps(1, 2, 3, 4), 4)
    log.discard(2)
    expect(log.count()).toBe(2)
    expect(replayed(log)).toEqual([[1, 2]])
  })

  test("discarding more than was recorded empties the log", () => {
    const log = createStampLog(8)
    log.append(stamps(1, 2), 2)
    log.discard(9)
    expect(log.count()).toBe(0)
    expect(replayed(log)).toEqual([])
  })

  test("reset forgets the stroke and restores replayability", () => {
    const log = createStampLog(2)
    log.append(stamps(1, 2, 3), 3)
    expect(log.replayable()).toBe(false)
    log.reset()
    expect(log.count()).toBe(0)
    expect(log.replayable()).toBe(true)
  })

  test("a stroke that outruns the log keeps drawing but stops promising a replay", () => {
    // Overflow must not allocate mid-stroke (D30), so the log stops recording
    // rather than growing; the renderer asks before trusting a replay.
    const log = createStampLog(3)
    log.append(stamps(1, 2), 2)
    log.append(stamps(3, 4), 2)
    expect(log.replayable()).toBe(false)
    expect(log.count()).toBe(3)
    expect(replayed(log)).toEqual([[1, 2, 3]])
  })

  test("a discard on an outrun log stays refused", () => {
    const log = createStampLog(2)
    log.append(stamps(1, 2, 3), 3)
    log.discard(1)
    expect(log.replayable()).toBe(false)
  })
})
