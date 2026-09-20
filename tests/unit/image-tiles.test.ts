import { describe, expect, test } from "bun:test"

import { decodeFloat16 } from "@/engine/doc/float16"
import { imageTiles } from "@/engine/doc/image-tiles"
import { TILE_CHANNELS, TILE_SIZE } from "@/engine/doc/tile-grid"

const CANVAS = { width: 512, height: 512 }

/** One opaque pixel of the colour given, as a browser would hand it over. */
function pixel(red: number, green: number, blue: number, alpha = 255) {
  return {
    width: 1,
    height: 1,
    pixels: new Uint8ClampedArray([red, green, blue, alpha]),
  }
}

function texelAt(
  tiles: ReturnType<typeof imageTiles>,
  x: number,
  y: number
): number[] {
  const tile = tiles.find(
    (candidate) =>
      candidate.x === Math.floor(x / TILE_SIZE) &&
      candidate.y === Math.floor(y / TILE_SIZE)
  )
  if (!tile) return [0, 0, 0, 0]
  const at = ((y % TILE_SIZE) * TILE_SIZE + (x % TILE_SIZE)) * TILE_CHANNELS
  return [...tile.texels.subarray(at, at + TILE_CHANNELS)].map(decodeFloat16)
}

describe("a placed image", () => {
  test("arrives in linear light rather than as the bytes it was encoded in", () => {
    const [red, , , alpha] = texelAt(
      imageTiles(pixel(128, 0, 0), { x: 0, y: 0 }, CANVAS),
      0,
      0
    )
    // Mid grey in sRGB is about 21.6% of the light, not 50% of it. Take the
    // byte straight and every imported photograph would come in washed out.
    expect(alpha).toBeCloseTo(1, 3)
    expect(red).toBeGreaterThan(0.1)
    expect(red).toBeLessThan(0.3)
  })

  test("is premultiplied, which is what every other surface holds", () => {
    const [red, , , alpha] = texelAt(
      imageTiles(pixel(255, 255, 255, 128), { x: 0, y: 0 }, CANVAS),
      0,
      0
    )
    expect(alpha).toBeCloseTo(128 / 255, 3)
    expect(red).toBeCloseTo(alpha, 3)
  })

  test("leaves transparent pixels transparent and colourless", () => {
    expect(
      texelAt(imageTiles(pixel(255, 0, 0, 0), { x: 0, y: 0 }, CANVAS), 0, 0)
    ).toEqual([0, 0, 0, 0])
  })

  test("costs the tiles it covers, not the canvas", () => {
    const tiles = imageTiles(
      { width: 4, height: 4, pixels: new Uint8ClampedArray(4 * 4 * 4) },
      { x: 0, y: 0 },
      { width: 4096, height: 4096 }
    )
    expect(tiles).toHaveLength(1)
  })

  test("spans every tile it crosses", () => {
    const width = TILE_SIZE + 2
    const tiles = imageTiles(
      {
        width,
        height: 1,
        pixels: new Uint8ClampedArray(width * 4).fill(255),
      },
      { x: 0, y: 0 },
      CANVAS
    )
    expect(tiles.map((tile) => tile.x).sort()).toEqual([0, 1])
    expect(texelAt(tiles, TILE_SIZE + 1, 0)[3]).toBeCloseTo(1, 3)
  })

  test("keeps only the part that lands on the canvas", () => {
    const tiles = imageTiles(
      { width: 2, height: 1, pixels: new Uint8ClampedArray(8).fill(255) },
      { x: -1, y: 0 },
      CANVAS
    )
    // The pixel hanging off the left edge is not stored: nothing could show
    // it, and a manifest naming it would be carrying pixels for nobody.
    expect(texelAt(tiles, 0, 0)[3]).toBeCloseTo(1, 3)
    expect(tiles).toHaveLength(1)
  })

  test("is nothing at all when it misses the canvas entirely", () => {
    expect(imageTiles(pixel(255, 255, 255), { x: -5, y: -5 }, CANVAS)).toEqual(
      []
    )
  })
})
