import { describe, expect, test } from "bun:test"
import { wandSelection } from "../../engine/doc/selection"
import { TILE_SIZE } from "../../engine/doc/tile-grid"

type Rgba = [number, number, number, number]

/** A straight-alpha RGBA8 image filled by `paint`. */
function image(
  width: number,
  height: number,
  paint: (x: number, y: number) => Rgba
) {
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) data.set(paint(x, y), (y * width + x) * 4)
  return { width, height, data }
}

const selected = (
  mask: ReturnType<typeof wandSelection>,
  width: number,
  height: number
) => {
  let count = 0
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) if (mask?.coverage(x, y) === 255) count++
  return count
}

describe("magic wand", () => {
  test("selects the flat region clicked, hard-edged, and nothing past it", () => {
    const pixels = image(20, 10, (x) =>
      x < 8 ? [200, 0, 0, 255] : [0, 0, 200, 255]
    )
    const mask = wandSelection(pixels, { x: 2, y: 3 }, 0)!
    expect(mask.bounds).toEqual({ x: 0, y: 0, width: 8, height: 10 })
    expect(selected(mask, 20, 10)).toBe(80)
    expect(mask.coverage(8, 0)).toBe(0)
  })

  test("tolerance admits colours within that many levels on every channel", () => {
    const pixels = image(3, 1, (x) => [100 + x * 10, 100, 100, 255])
    expect(selected(wandSelection(pixels, { x: 0, y: 0 }, 9), 3, 1)).toBe(1)
    expect(selected(wandSelection(pixels, { x: 0, y: 0 }, 10), 3, 1)).toBe(2)
    expect(selected(wandSelection(pixels, { x: 0, y: 0 }, 20), 3, 1)).toBe(3)
  })

  test("measures against the clicked colour, so a gradient does not creep", () => {
    const pixels = image(50, 1, (x) => [x * 5, 0, 0, 255])
    const mask = wandSelection(pixels, { x: 0, y: 0 }, 12)!
    expect(mask.bounds).toEqual({ x: 0, y: 0, width: 3, height: 1 })
  })

  test("is contiguous: a matching region cut off by a wall is left out", () => {
    const pixels = image(9, 3, (x) =>
      x === 4 ? [0, 0, 0, 255] : [255, 255, 255, 255]
    )
    const mask = wandSelection(pixels, { x: 0, y: 1 }, 0)!
    expect(mask.bounds).toEqual({ x: 0, y: 0, width: 4, height: 3 })
  })

  test("does not leak through a diagonal gap", () => {
    // White everywhere but a black diagonal; the corners only touch.
    const pixels = image(4, 4, (x, y) =>
      x === y ? [0, 0, 0, 255] : [255, 255, 255, 255]
    )
    const mask = wandSelection(pixels, { x: 3, y: 0 }, 0)!
    expect(mask.coverage(0, 3)).toBe(0)
    expect(selected(mask, 4, 4)).toBe(6)
  })

  test("treats every fully transparent pixel alike, whatever colour it holds", () => {
    const pixels = image(4, 1, (x) =>
      x < 3 ? [x * 90, 50, 0, 0] : [0, 0, 0, 255]
    )
    const mask = wandSelection(pixels, { x: 0, y: 0 }, 0)!
    expect(mask.bounds).toEqual({ x: 0, y: 0, width: 3, height: 1 })
  })

  test("tells opacity apart like any other channel", () => {
    const pixels = image(3, 1, (x) => [255, 0, 0, 255 - x * 40])
    expect(selected(wandSelection(pixels, { x: 0, y: 0 }, 39), 3, 1)).toBe(1)
    expect(selected(wandSelection(pixels, { x: 0, y: 0 }, 40), 3, 1)).toBe(2)
  })

  test("a click off the image selects nothing", () => {
    const pixels = image(4, 4, () => [0, 0, 0, 255])
    expect(wandSelection(pixels, { x: -1, y: 0 }, 255)).toBeNull()
    expect(wandSelection(pixels, { x: 4, y: 0 }, 255)).toBeNull()
  })

  test("spans tiles, keeping the wholly selected ones shared", () => {
    const width = TILE_SIZE * 2 + 10
    const pixels = image(width, 5, () => [9, 9, 9, 255])
    const mask = wandSelection(pixels, { x: 0, y: 0 }, 0)!
    expect(mask.bounds).toEqual({ x: 0, y: 0, width, height: 5 })
    expect(mask.tileCount()).toBe(3)
  })
})
