import { describe, expect, test } from "bun:test"

import {
  featherSelection,
  rectSelection,
  transformSelection,
} from "@/engine/doc/selection"
import { affineFromPlacement } from "@/engine/doc/transform-session"
import { layerStartPlacement } from "@/engine/doc/layer-transform"

const size = { width: 400, height: 300 }
const rect = { x: 100, y: 100, width: 40, height: 20 }

describe("transformSelection", () => {
  test("picked up and put down where it was, the mask is unchanged", () => {
    const mask = rectSelection(size, rect)!
    const matrix = affineFromPlacement(layerStartPlacement(rect), rect)
    const moved = transformSelection(size, mask, rect, matrix)!
    expect(moved.bounds).toEqual(rect)
    expect(moved.coverage(120, 110)).toBe(255)
    expect(moved.coverage(99, 110)).toBe(0)
  })

  test("follows a move and a scale", () => {
    const mask = rectSelection(size, rect)!
    const placement = {
      ...layerStartPlacement(rect),
      x: 250,
      y: 200,
      width: 80,
      height: 40,
    }
    const moved = transformSelection(
      size,
      mask,
      rect,
      affineFromPlacement(placement, rect)
    )!
    expect(moved.bounds).toEqual({ x: 210, y: 180, width: 80, height: 40 })
    expect(moved.coverage(250, 200)).toBe(255)
    expect(moved.coverage(120, 110)).toBe(0)
  })

  test("turns with a quarter rotation", () => {
    const mask = rectSelection(size, rect)!
    const placement = { ...layerStartPlacement(rect), rotation: Math.PI / 2 }
    const moved = transformSelection(
      size,
      mask,
      rect,
      affineFromPlacement(placement, rect)
    )!
    // 40×20 about (120, 110) becomes 20×40.
    expect(moved.bounds).toEqual({ x: 110, y: 90, width: 20, height: 40 })
  })

  test("carries a feathered edge", () => {
    const mask = featherSelection(size, rectSelection(size, rect)!, 6)!
    const source = mask.bounds
    const placement = { ...layerStartPlacement(source), x: 300 }
    const moved = transformSelection(
      size,
      mask,
      source,
      affineFromPlacement(placement, source)
    )!
    const dx = 300 - (source.x + source.width / 2)
    for (const x of [96, 100, 104, 120])
      expect(
        Math.abs(moved.coverage(x + dx, 110) - mask.coverage(x, 110))
      ).toBeLessThanOrEqual(1)
  })

  test("moved wholly off the canvas, nothing is left", () => {
    const mask = rectSelection(size, rect)!
    const placement = { ...layerStartPlacement(rect), x: -500 }
    expect(
      transformSelection(size, mask, rect, affineFromPlacement(placement, rect))
    ).toBeNull()
  })
})
