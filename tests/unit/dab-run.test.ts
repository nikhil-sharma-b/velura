import { describe, expect, test } from "bun:test"
import { DAB_RECT, DAB_RECT_STRIDE, dabRunEnd } from "../../engine/gpu/dab-run"

/** Dabs as the rectangles each reads, laid out as the direct stroke keeps them. */
function rects(...read: [number, number, number, number][]): Int32Array {
  const out = new Int32Array(read.length * DAB_RECT_STRIDE)
  read.forEach(([left, top, width, height], index) => {
    out[index * DAB_RECT_STRIDE + DAB_RECT.READ_LEFT] = left
    out[index * DAB_RECT_STRIDE + DAB_RECT.READ_TOP] = top
    out[index * DAB_RECT_STRIDE + DAB_RECT.READ_WIDTH] = width
    out[index * DAB_RECT_STRIDE + DAB_RECT.READ_HEIGHT] = height
  })
  return out
}

describe("dabRunEnd", () => {
  test("a run takes every dab while what they read fits the limit, and says where that is", () => {
    const region = new Int32Array(4)
    const dabs = rects([10, 20, 16, 16], [11, 20, 16, 16], [12, 19, 16, 16])
    expect(dabRunEnd(dabs, 0, 3, 64, region)).toBe(3)
    expect(Array.from(region)).toEqual([10, 19, 18, 17])
  })

  test("a run stops before the dab that would take it past the limit", () => {
    const region = new Int32Array(4)
    const dabs = rects([0, 0, 16, 16], [40, 0, 16, 16], [60, 0, 16, 16])
    expect(dabRunEnd(dabs, 0, 3, 64, region)).toBe(2)
    expect(Array.from(region)).toEqual([0, 0, 56, 16])
  })

  test("the limit holds down the page as it does across it", () => {
    const region = new Int32Array(4)
    const dabs = rects([0, 0, 16, 16], [0, 50, 16, 16])
    expect(dabRunEnd(dabs, 0, 2, 64, region)).toBe(1)
    expect(Array.from(region)).toEqual([0, 0, 16, 16])
  })

  test("a run starts where it is told to, and a region exactly at the limit fits", () => {
    const region = new Int32Array(4)
    const dabs = rects([0, 0, 16, 16], [100, 100, 16, 16], [148, 100, 16, 16])
    expect(dabRunEnd(dabs, 1, 3, 64, region)).toBe(3)
    expect(Array.from(region)).toEqual([100, 100, 64, 16])
  })

  test("a dab too large for the limit is no run at all", () => {
    const region = new Int32Array([1, 2, 3, 4])
    const dabs = rects([0, 0, 65, 16], [0, 0, 16, 16])
    expect(dabRunEnd(dabs, 0, 2, 64, region)).toBe(0)
    expect(Array.from(region)).toEqual([1, 2, 3, 4])
  })
})
