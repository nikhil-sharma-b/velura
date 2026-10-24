import { describe, expect, test } from "bun:test"
import {
  combineSelections,
  dragRect,
  ellipseSelection,
  invertSelection,
  lassoSelection,
  rectSelection,
  sameSelection,
  selectAll,
} from "../../engine/doc/selection"
import { TILE_SIZE } from "../../engine/doc/tile-grid"

const size = { width: 1000, height: 600 }

describe("rectangle selection", () => {
  test("covers exactly its pixels and reports them as its bounds", () => {
    const mask = rectSelection(size, { x: 10, y: 20, width: 30, height: 40 })!
    expect(mask.bounds).toEqual({ x: 10, y: 20, width: 30, height: 40 })
    expect(mask.coverage(10, 20)).toBe(255)
    expect(mask.coverage(39, 59)).toBe(255)
    expect(mask.coverage(9, 20)).toBe(0)
    expect(mask.coverage(40, 20)).toBe(0)
    expect(mask.coverage(10, 60)).toBe(0)
  })

  test("allocates only the tiles it touches; empty regions cost nothing", () => {
    const mask = rectSelection(size, { x: 10, y: 20, width: 30, height: 40 })!
    expect(mask.tileCount()).toBe(1)
    const spanning = rectSelection(size, {
      x: TILE_SIZE - 5,
      y: 0,
      width: 10,
      height: 10,
    })!
    expect(spanning.tileCount()).toBe(2)
  })

  test("interior tiles share one full tile rather than each holding a copy", () => {
    const mask = selectAll(size)
    const tiles = mask.tiles()
    const interior = tiles.filter((tile) => tile.full)
    expect(interior.length).toBeGreaterThan(1)
    expect(new Set(interior.map((tile) => tile.coverage)).size).toBe(1)
  })

  test("is clipped to the canvas, and one entirely off it selects nothing", () => {
    const mask = rectSelection(size, {
      x: -50,
      y: 580,
      width: 100,
      height: 100,
    })!
    expect(mask.bounds).toEqual({ x: 0, y: 580, width: 50, height: 20 })
    expect(
      rectSelection(size, { x: 2000, y: 0, width: 10, height: 10 })
    ).toBeNull()
    expect(rectSelection(size, { x: 5, y: 5, width: 0, height: 10 })).toBeNull()
  })

  test("fractional corners snap to whole pixels, so edges stay hard", () => {
    const mask = rectSelection(size, {
      x: 10.4,
      y: 10.6,
      width: 5.2,
      height: 5,
    })!
    expect(mask.bounds).toEqual({ x: 10, y: 11, width: 6, height: 5 })
  })
})

describe("ellipse selection", () => {
  const rect = { x: 100, y: 100, width: 200, height: 100 }

  test("is solid at the centre, empty at the box corners, soft at the rim", () => {
    const mask = ellipseSelection(size, rect)!
    expect(mask.coverage(200, 150)).toBe(255)
    expect(mask.coverage(100, 100)).toBe(0)
    expect(mask.coverage(299, 199)).toBe(0)
    // The rightmost point of the rim is antialiased rather than stepped.
    const rim = mask.coverage(299, 150)
    expect(rim).toBeGreaterThan(0)
    expect(rim).toBeLessThan(255)
  })

  test("is symmetric about both axes", () => {
    const mask = ellipseSelection(size, rect)!
    for (const [x, y] of [
      [110, 130],
      [150, 105],
      [120, 170],
    ]) {
      const mirrorX = 2 * 200 - 1 - x
      const mirrorY = 2 * 150 - 1 - y
      expect(mask.coverage(mirrorX, y)).toBe(mask.coverage(x, y))
      expect(mask.coverage(x, mirrorY)).toBe(mask.coverage(x, y))
    }
  })

  test("is bounded by its box", () => {
    expect(ellipseSelection(size, rect)!.bounds).toEqual(rect)
  })
})

describe("select all and invert", () => {
  test("select all covers the canvas", () => {
    const mask = selectAll(size)
    expect(mask.bounds).toEqual({ x: 0, y: 0, ...size })
    expect(mask.coverage(999, 599)).toBe(255)
  })

  test("inverting nothing selects everything, and everything inverts to nothing", () => {
    expect(invertSelection(size, null)!.bounds).toEqual({
      x: 0,
      y: 0,
      ...size,
    })
    expect(invertSelection(size, selectAll(size))).toBeNull()
  })

  test("invert flips coverage and a double invert gives the original back", () => {
    const mask = ellipseSelection(size, {
      x: 100,
      y: 100,
      width: 200,
      height: 100,
    })!
    const inverted = invertSelection(size, mask)!
    for (const [x, y] of [
      [200, 150],
      [0, 0],
      [299, 150],
      [999, 599],
    ])
      expect(inverted.coverage(x, y)).toBe(255 - mask.coverage(x, y))
    expect(inverted.bounds).toEqual({ x: 0, y: 0, ...size })
    const back = invertSelection(size, inverted)!
    expect(back.bounds).toEqual(mask.bounds)
    expect(back.tileCount()).toBe(mask.tileCount())
    for (let y = 95; y < 205; y += 3)
      for (let x = 95; x < 305; x += 3)
        expect(back.coverage(x, y)).toBe(mask.coverage(x, y))
  })

  test("the bounds of an inverted selection are what is left selected", () => {
    const left = rectSelection(size, { x: 0, y: 0, width: 400, height: 600 })!
    expect(invertSelection(size, left)!.bounds).toEqual({
      x: 400,
      y: 0,
      width: 600,
      height: 600,
    })
  })
})

describe("dragging out a shape", () => {
  test("spans the anchor and the pen in either direction", () => {
    expect(dragRect({ x: 50, y: 60 }, { x: 10, y: 100 }, false)).toEqual({
      x: 10,
      y: 60,
      width: 40,
      height: 40,
    })
  })

  test("constrained, it is a square on the longer side, toward the pen", () => {
    expect(dragRect({ x: 50, y: 50 }, { x: 80, y: 60 }, true)).toEqual({
      x: 50,
      y: 50,
      width: 30,
      height: 30,
    })
    expect(dragRect({ x: 50, y: 50 }, { x: 40, y: 10 }, true)).toEqual({
      x: 10,
      y: 10,
      width: 40,
      height: 40,
    })
  })
})

describe("large shapes", () => {
  test("an ellipse's interior tiles are the shared full tile", () => {
    const big = { width: 4096, height: 4096 }
    const mask = ellipseSelection(big, { x: 0, y: 0, ...big })!
    const full = mask.tiles().filter((tile) => tile.full)
    expect(full.length).toBeGreaterThan(100)
    // Any texel of those tiles reads as wholly selected.
    for (const tile of full.slice(0, 5))
      expect(mask.coverage(tile.x * TILE_SIZE, tile.y * TILE_SIZE)).toBe(255)
  })
})

describe("sameSelection", () => {
  test("tells an unchanged selection from a changed one", () => {
    const rect = { x: 10, y: 10, width: 50, height: 40 }
    expect(sameSelection(null, null)).toBe(true)
    expect(sameSelection(selectAll(size), selectAll(size))).toBe(true)
    expect(
      sameSelection(ellipseSelection(size, rect), ellipseSelection(size, rect))
    ).toBe(true)
    expect(
      sameSelection(rectSelection(size, rect), ellipseSelection(size, rect))
    ).toBe(false)
    expect(sameSelection(rectSelection(size, rect), null)).toBe(false)
  })
})

describe("lasso selection", () => {
  test("fills the closed outline, pixel centres inside it selected", () => {
    const mask = lassoSelection(size, [
      { x: 10, y: 10 },
      { x: 50, y: 10 },
      { x: 50, y: 40 },
      { x: 10, y: 40 },
    ])!
    expect(mask.bounds).toEqual({ x: 10, y: 10, width: 40, height: 30 })
    expect(mask.coverage(10, 10)).toBe(255)
    expect(mask.coverage(49, 39)).toBe(255)
    expect(mask.coverage(50, 20)).toBe(0)
  })

  test("closes the outline itself: a triangle leaves its far corner out", () => {
    const mask = lassoSelection(size, [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 0, y: 100 },
    ])!
    expect(mask.coverage(10, 10)).toBe(255)
    expect(mask.coverage(90, 90)).toBe(0)
    expect(mask.coverage(60, 30)).toBe(255)
    expect(mask.coverage(60, 45)).toBe(0)
  })

  test("a self-crossing outline selects both lobes of the figure eight", () => {
    const mask = lassoSelection(size, [
      { x: 0, y: 0 },
      { x: 40, y: 40 },
      { x: 40, y: 0 },
      { x: 0, y: 40 },
    ])!
    expect(mask.coverage(5, 20)).toBe(255)
    expect(mask.coverage(35, 20)).toBe(255)
    expect(mask.coverage(20, 5)).toBe(0)
  })

  test("fewer than three points, or no area, selects nothing", () => {
    expect(lassoSelection(size, [])).toBeNull()
    expect(
      lassoSelection(size, [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ])
    ).toBeNull()
    expect(
      lassoSelection(size, [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
        { x: 20, y: 20 },
      ])
    ).toBeNull()
  })

  test("a large outline fills interior tiles with the shared full tile", () => {
    const mask = lassoSelection(size, [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 600 },
      { x: 0, y: 600 },
    ])!
    expect(sameSelection(mask, selectAll(size))).toBe(true)
    expect(mask.tiles().every((tile) => tile.full)).toBe(true)
  })

  test("clips to the canvas", () => {
    const mask = lassoSelection(size, [
      { x: -50, y: -50 },
      { x: 20, y: -50 },
      { x: 20, y: 20 },
      { x: -50, y: 20 },
    ])!
    expect(mask.bounds).toEqual({ x: 0, y: 0, width: 20, height: 20 })
  })
})

describe("combining selections", () => {
  const a = () => rectSelection(size, { x: 0, y: 0, width: 60, height: 40 })
  const b = () => rectSelection(size, { x: 40, y: 20, width: 60, height: 40 })

  test("replace keeps only the new shape", () => {
    const next = b()
    expect(combineSelections(size, a(), next, "replace")).toBe(next)
  })

  test("add is the union", () => {
    const mask = combineSelections(size, a(), b(), "add")!
    expect(mask.bounds).toEqual({ x: 0, y: 0, width: 100, height: 60 })
    expect(mask.coverage(5, 5)).toBe(255)
    expect(mask.coverage(95, 55)).toBe(255)
    expect(mask.coverage(95, 5)).toBe(0)
  })

  test("subtract takes the new shape away", () => {
    const mask = combineSelections(size, a(), b(), "subtract")!
    expect(mask.coverage(5, 5)).toBe(255)
    expect(mask.coverage(50, 30)).toBe(0)
    expect(mask.coverage(50, 10)).toBe(255)
    expect(mask.coverage(95, 55)).toBe(0)
  })

  test("intersect keeps only the overlap", () => {
    const mask = combineSelections(size, a(), b(), "intersect")!
    expect(mask.bounds).toEqual({ x: 40, y: 20, width: 20, height: 20 })
  })

  test("with nothing selected, add and replace give the shape; subtract and intersect nothing", () => {
    expect(sameSelection(combineSelections(size, null, b(), "add"), b())).toBe(
      true
    )
    expect(combineSelections(size, null, b(), "subtract")).toBeNull()
    expect(combineSelections(size, null, b(), "intersect")).toBeNull()
  })

  test("an empty shape leaves add and subtract as they were, empties intersect", () => {
    const base = a()
    expect(combineSelections(size, base, null, "add")).toBe(base)
    expect(combineSelections(size, base, null, "subtract")).toBe(base)
    expect(combineSelections(size, base, null, "intersect")).toBeNull()
  })

  test("soft edges combine by coverage", () => {
    const soft = ellipseSelection(size, { x: 0, y: 0, width: 40, height: 40 })!
    let edge = { x: 0, y: 0 }
    for (let x = 0; x < 40; x++) {
      const v = soft.coverage(x, 3)
      if (v > 0 && v < 255) edge = { x, y: 3 }
    }
    const value = soft.coverage(edge.x, edge.y)
    expect(value).toBeGreaterThan(0)
    expect(value).toBeLessThan(255)
    const removed = combineSelections(size, selectAll(size), soft, "subtract")!
    expect(removed.coverage(edge.x, edge.y)).toBe(255 - value)
  })

  test("tiles untouched by the shape are shared, not copied", () => {
    const far = rectSelection(size, { x: 900, y: 530, width: 50, height: 50 })!
    const all = selectAll(size)
    const mask = combineSelections(size, all, far, "subtract")!
    const shared = mask.tiles().filter((tile) => tile.full).length
    expect(shared).toBe(all.tileCount() - 1)
  })
})
