import { describe, expect, test } from "bun:test"
import {
  featherSelection,
  rectSelection,
  sameSelection,
  selectAll,
  translateSelection,
} from "../../engine/doc/selection"

const size = { width: 1000, height: 600 }
const rect = { x: 200, y: 200, width: 200, height: 100 }

describe("feather", () => {
  test("softens a hard edge into a ramp across the radius", () => {
    const mask = featherSelection(size, rectSelection(size, rect)!, 10)!
    // Deep inside and far outside are untouched.
    expect(mask.coverage(300, 250)).toBe(255)
    expect(mask.coverage(150, 250)).toBe(0)
    // On the edge itself, about half selected.
    const edge = mask.coverage(200, 250)
    expect(edge).toBeGreaterThan(90)
    expect(edge).toBeLessThan(165)
    // Monotonic across the edge.
    let previous = -1
    for (let x = 185; x <= 215; x++) {
      const value = mask.coverage(x, 250)
      expect(value).toBeGreaterThanOrEqual(previous)
      previous = value
    }
    // Just outside the hard edge is now partly selected, just inside partly not.
    expect(mask.coverage(195, 250)).toBeGreaterThan(0)
    expect(mask.coverage(204, 250)).toBeLessThan(255)
  })

  test("grows the bounds by the spread of the blur", () => {
    const mask = featherSelection(size, rectSelection(size, rect)!, 10)!
    expect(mask.bounds.x).toBeLessThan(200)
    expect(mask.bounds.x).toBeGreaterThan(200 - 30)
    expect(mask.bounds.x + mask.bounds.width).toBeGreaterThan(400)
  })

  test("a zero radius leaves the selection as it is", () => {
    const hard = rectSelection(size, rect)!
    expect(featherSelection(size, hard, 0)).toBe(hard)
  })

  test("the canvas edge does not fade: everything feathered is everything", () => {
    const all = selectAll(size)
    expect(sameSelection(featherSelection(size, all, 20), all)).toBe(true)
  })

  test("a selection much smaller than the radius fades to nothing", () => {
    const dot = rectSelection(size, { x: 500, y: 300, width: 1, height: 1 })!
    expect(featherSelection(size, dot, 60)).toBeNull()
  })
})

describe("move outline", () => {
  test("shifts coverage by whole pixels", () => {
    const moved = translateSelection(size, rectSelection(size, rect)!, 30, -20)!
    expect(moved.bounds).toEqual({ x: 230, y: 180, width: 200, height: 100 })
    expect(moved.coverage(230, 180)).toBe(255)
    expect(moved.coverage(229, 180)).toBe(0)
  })

  test("keeps soft coverage as it was", () => {
    const soft = featherSelection(size, rectSelection(size, rect)!, 8)!
    const moved = translateSelection(size, soft, 7, 3)!
    for (const x of [190, 200, 205, 300])
      expect(moved.coverage(x + 7, 253)).toBe(soft.coverage(x, 250))
  })

  test("is clipped to the canvas, and moved wholly off it is nothing", () => {
    const moved = translateSelection(size, rectSelection(size, rect)!, 700, 0)!
    expect(moved.bounds).toEqual({ x: 900, y: 200, width: 100, height: 100 })
    expect(
      translateSelection(size, rectSelection(size, rect)!, 900, 0)
    ).toBeNull()
  })

  test("no movement is the same mask", () => {
    const mask = rectSelection(size, rect)!
    expect(translateSelection(size, mask, 0.2, -0.3)).toBe(mask)
  })
})
