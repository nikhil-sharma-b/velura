import { describe, expect, test } from "bun:test"

import {
  createContentBounds,
  frameContent,
} from "../../engine/view/content-bounds"

describe("where a layer's pixels are", () => {
  test("nothing is known about a surface nothing has touched", () => {
    expect(createContentBounds().get("a")).toBeUndefined()
  })

  test("marks grow one box around everything they touched", () => {
    const bounds = createContentBounds()
    bounds.grow("a", { x: 10, y: 20, width: 5, height: 5 })
    bounds.grow("a", { x: 100, y: 0, width: 10, height: 10 })
    expect(bounds.get("a")).toEqual({ x: 10, y: 0, width: 100, height: 25 })
  })

  test("tiles count as their whole square", () => {
    const bounds = createContentBounds()
    bounds.growTiles("a", [
      { x: 1, y: 0 },
      { x: 2, y: 1 },
    ])
    expect(bounds.get("a")).toEqual({ x: 256, y: 0, width: 512, height: 512 })
  })

  test("a copy starts where its source is, and a forgotten surface is gone", () => {
    const bounds = createContentBounds()
    bounds.grow("a", { x: 1, y: 2, width: 3, height: 4 })
    bounds.copy("a", "b")
    bounds.forget("a")
    expect(bounds.get("a")).toBeUndefined()
    expect(bounds.get("b")).toEqual({ x: 1, y: 2, width: 3, height: 4 })
  })

  test("a group's box is the union of its members'", () => {
    const bounds = createContentBounds()
    bounds.grow("a", { x: 0, y: 0, width: 10, height: 10 })
    bounds.grow("b", { x: 50, y: 50, width: 10, height: 10 })
    expect(bounds.union(["a", "b", "never"])).toEqual({
      x: 0,
      y: 0,
      width: 60,
      height: 60,
    })
    expect(bounds.union(["never"])).toBeUndefined()
  })
})

describe("framing a layer's work for its thumbnail", () => {
  const canvas = { width: 1000, height: 1000 }

  test("leaves a margin around the work, inside the canvas", () => {
    expect(
      frameContent({ x: 400, y: 400, width: 200, height: 100 }, canvas)
    ).toEqual({ x: 390, y: 390, width: 220, height: 120 })
    expect(
      frameContent({ x: 0, y: 0, width: 1000, height: 1000 }, canvas)
    ).toEqual({ x: 0, y: 0, width: 1000, height: 1000 })
  })

  test("never zooms past a readable minimum, so a dot stays a dot", () => {
    expect(
      frameContent({ x: 500, y: 500, width: 2, height: 2 }, canvas)
    ).toEqual({ x: 469, y: 469, width: 64, height: 64 })
  })
})
