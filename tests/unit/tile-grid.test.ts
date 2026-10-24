import { describe, expect, test } from "bun:test"
import {
  createDirtyRegion,
  createTouchedTiles,
  intersectRect,
  TILE_SIZE,
  tileBounds,
  tileIndexForPixel,
  tileKey,
  tilesCoveringRect,
} from "../../engine/doc/tile-grid"

describe("pixel to tile mapping", () => {
  test("maps a pixel to the tile that contains it", () => {
    expect(tileIndexForPixel(0)).toBe(0)
    expect(tileIndexForPixel(TILE_SIZE - 1)).toBe(0)
    expect(tileIndexForPixel(TILE_SIZE)).toBe(1)
    expect(tileIndexForPixel(TILE_SIZE * 3 + 5)).toBe(3)
  })

  test("truncates fractional pixel positions downwards", () => {
    expect(tileIndexForPixel(255.9)).toBe(0)
    expect(tileIndexForPixel(256.1)).toBe(1)
  })

  test("reports the pixel rectangle a tile covers", () => {
    expect(tileBounds({ x: 2, y: 1 })).toEqual({
      x: 512,
      y: 256,
      width: 256,
      height: 256,
    })
  })

  test("keys are unique per tile coordinate", () => {
    expect(tileKey(1, 2)).not.toBe(tileKey(2, 1))
  })
})

describe("tiles covering a rectangle", () => {
  test("a rectangle inside one tile covers exactly that tile", () => {
    expect(tilesCoveringRect({ x: 4, y: 4, width: 8, height: 8 })).toEqual([
      { x: 0, y: 0 },
    ])
  })

  test("a rectangle straddling a boundary covers both tiles", () => {
    expect(tilesCoveringRect({ x: 250, y: 0, width: 12, height: 4 })).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ])
  })

  test("a rectangle ending on a boundary does not touch the next tile", () => {
    expect(tilesCoveringRect({ x: 0, y: 0, width: 256, height: 256 })).toEqual([
      { x: 0, y: 0 },
    ])
  })

  test("an empty rectangle covers nothing", () => {
    expect(tilesCoveringRect({ x: 10, y: 10, width: 0, height: 5 })).toEqual([])
  })
})

describe("rectangle intersection", () => {
  test("clips a rectangle to the canvas", () => {
    expect(
      intersectRect(
        { x: -4, y: -4, width: 10, height: 10 },
        { x: 0, y: 0, width: 4, height: 8 }
      )
    ).toEqual({ x: 0, y: 0, width: 4, height: 6 })
  })

  test("disjoint rectangles intersect in nothing", () => {
    expect(
      intersectRect(
        { x: 0, y: 0, width: 4, height: 4 },
        { x: 8, y: 0, width: 4, height: 4 }
      )
    ).toBeNull()
  })
})

describe("dirty region bounds", () => {
  test("an untouched region has no bounds", () => {
    expect(createDirtyRegion().bounds()).toBeNull()
  })

  test("bounds grow to the union of everything included", () => {
    const region = createDirtyRegion()
    region.include({ x: 10, y: 20, width: 5, height: 5 })
    region.include({ x: 300, y: 4, width: 2, height: 2 })
    expect(region.bounds()).toEqual({ x: 10, y: 4, width: 292, height: 21 })
  })

  test("empty rectangles never widen the bounds", () => {
    const region = createDirtyRegion()
    region.include({ x: 10, y: 10, width: 4, height: 4 })
    region.include({ x: 900, y: 900, width: 0, height: 0 })
    expect(region.bounds()).toEqual({ x: 10, y: 10, width: 4, height: 4 })
  })

  test("clearing forgets the accumulated bounds", () => {
    const region = createDirtyRegion()
    region.include({ x: 1, y: 1, width: 1, height: 1 })
    region.clear()
    expect(region.bounds()).toBeNull()
  })

  test("dirty bounds name the tiles that need re-uploading", () => {
    const region = createDirtyRegion()
    region.include({ x: 254, y: 2, width: 4, height: 2 })
    expect(tilesCoveringRect(region.bounds()!)).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ])
  })
})

describe("the tiles a stroke's dabs touched", () => {
  test("holds each dab's own tiles, not those of the box round them all", () => {
    const touched = createTouchedTiles()
    // Two dabs thrown to opposite corners of a three by three block.
    touched.include(10, 10, 20, 20)
    touched.include(TILE_SIZE * 2 + 10, TILE_SIZE * 2 + 10, 600, 600)
    expect(
      touched.within({
        x: 0,
        y: 0,
        width: TILE_SIZE * 3,
        height: TILE_SIZE * 3,
      })
    ).toEqual([
      { x: 0, y: 0 },
      { x: 2, y: 2 },
    ])
  })

  test("answers along the rows, each tile once", () => {
    const touched = createTouchedTiles()
    touched.include(TILE_SIZE - 4, TILE_SIZE + 4, TILE_SIZE + 4, TILE_SIZE + 8)
    touched.include(4, 4, TILE_SIZE + 4, 8)
    touched.include(8, 8, 12, 12)
    expect(
      touched.within({
        x: 0,
        y: 0,
        width: TILE_SIZE * 2,
        height: TILE_SIZE * 2,
      })
    ).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ])
  })

  test("a dab ending on a tile's edge stops short of the next", () => {
    const touched = createTouchedTiles()
    touched.include(0, 0, TILE_SIZE, TILE_SIZE)
    expect(
      touched.within({
        x: 0,
        y: 0,
        width: TILE_SIZE * 2,
        height: TILE_SIZE * 2,
      })
    ).toEqual([{ x: 0, y: 0 }])
  })

  test("leaves out what the region does not reach, and what is off the canvas", () => {
    const touched = createTouchedTiles()
    touched.include(-40, -40, 10, 10)
    touched.include(TILE_SIZE * 3, 0, TILE_SIZE * 3 + 10, 10)
    expect(
      touched.within({ x: 0, y: 0, width: TILE_SIZE * 2, height: TILE_SIZE })
    ).toEqual([{ x: 0, y: 0 }])
  })

  test("an empty dab touches nothing, and clearing forgets", () => {
    const touched = createTouchedTiles()
    const everywhere = { x: 0, y: 0, width: 4096, height: 4096 }
    touched.include(10, 10, 10, 30)
    expect(touched.within(everywhere)).toEqual([])
    touched.include(10, 10, 30, 30)
    touched.clear()
    expect(touched.within(everywhere)).toEqual([])
  })
})
