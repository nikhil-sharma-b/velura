import { describe, expect, test } from "bun:test"
import { createSampleBuffer } from "../../engine/input/sample-buffer"

type Sample = { x: number; y: number; pressure: number }

function drain(buffer: ReturnType<typeof createSampleBuffer>): Sample[] {
  const drained: Sample[] = []
  buffer.drain((x, y, pressure) => drained.push({ x, y, pressure }))
  return drained
}

/** A sample with only the fields a test cares about spelled out. */
function push(
  buffer: ReturnType<typeof createSampleBuffer>,
  x: number,
  y: number,
  pressure: number
) {
  buffer.push(x, y, pressure, 0, 0, 0)
}

describe("pointer sample ring buffer", () => {
  test("drains samples in the order they arrived", () => {
    const buffer = createSampleBuffer(8)
    push(buffer, 1, 2, 0.5)
    push(buffer, 3, 4, 0.75)
    expect(drain(buffer)).toEqual([
      { x: 1, y: 2, pressure: 0.5 },
      { x: 3, y: 4, pressure: 0.75 },
    ])
  })

  test("draining empties the buffer", () => {
    const buffer = createSampleBuffer(8)
    push(buffer, 1, 2, 1)
    drain(buffer)
    expect(drain(buffer)).toEqual([])
    expect(buffer.size()).toBe(0)
  })

  test("wraps around its capacity across many frames", () => {
    // A 240 Hz pen fills and empties this buffer several times a second, so
    // the write cursor must wrap without disturbing ordering.
    const buffer = createSampleBuffer(4)
    for (let frame = 0; frame < 10; frame++) {
      for (let i = 0; i < 3; i++) push(buffer, frame * 3 + i, 0, 1)
      expect(drain(buffer).map((s) => s.x)).toEqual([
        frame * 3,
        frame * 3 + 1,
        frame * 3 + 2,
      ])
    }
  })

  test("an overrun drops the oldest samples, never the pen's latest position", () => {
    const buffer = createSampleBuffer(3)
    for (let i = 0; i < 5; i++) push(buffer, i, 0, 1)
    expect(drain(buffer).map((s) => s.x)).toEqual([2, 3, 4])
  })

  test("clearing discards samples buffered before a stroke ends", () => {
    const buffer = createSampleBuffer(8)
    push(buffer, 1, 1, 1)
    buffer.clear()
    expect(buffer.size()).toBe(0)
    expect(drain(buffer)).toEqual([])
  })

  test("capacity is fixed at construction so the frame path never allocates", () => {
    const buffer = createSampleBuffer(2)
    for (let i = 0; i < 1000; i++) push(buffer, i, i, 1)
    expect(buffer.capacity()).toBe(2)
    expect(buffer.size()).toBe(2)
  })
})
