import { describe, expect, test } from "bun:test"

import { MAX_TEXTURE_DIMENSION } from "@/convex/lib/brush"
import { importedSize, toGrayscale } from "@/features/studio/lib/texture-import"

describe("an imported image", () => {
  test("becomes one byte of coverage per texel, dark being the ink", () => {
    const texture = toGrayscale(
      new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255]),
      2,
      1
    )
    // A stamp is a dark mark on white paper: black is full coverage, and the
    // paper around it marks nothing.
    expect(texture).toEqual({
      width: 2,
      height: 1,
      data: new Uint8Array([255, 0]),
    })
  })

  test("weighs the channels by how bright they look, not equally", () => {
    // Green reads as the brighter of the two, so it is the weaker ink.
    const [green] = toGrayscale(new Uint8Array([0, 255, 0, 255]), 1, 1).data
    const [blue] = toGrayscale(new Uint8Array([0, 0, 255, 255]), 1, 1).data
    expect(green).toBeLessThan(blue)
  })

  test("reads transparency as nothing rather than as ink", () => {
    // A cut-out tip on a transparent background is the shape it draws, so
    // where the file has nothing the brush marks nothing.
    expect(toGrayscale(new Uint8Array([0, 0, 0, 0]), 1, 1).data[0]).toBe(0)
    expect(toGrayscale(new Uint8Array([0, 0, 0, 255]), 1, 1).data[0]).toBe(255)
  })

  test("is brought down to a size a row can hold, keeping its proportions", () => {
    expect(importedSize(4000, 2000)).toEqual({
      width: MAX_TEXTURE_DIMENSION,
      height: MAX_TEXTURE_DIMENSION / 2,
    })
    expect(importedSize(64, 32)).toEqual({ width: 64, height: 32 })
  })
})
