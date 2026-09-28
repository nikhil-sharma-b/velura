import { describe, expect, test } from "bun:test"

import { encodeFloat16 } from "@/engine/doc/float16"
import {
  layerStartPlacement,
  coveredBounds,
} from "@/engine/doc/layer-transform"
import { TILE_CHANNELS, TILE_SIZE } from "@/engine/doc/tile-grid"
import { affineFromPlacement, sameAffine } from "@/engine/doc/transform-session"

function tile(opaque: { x: number; y: number }[]): Uint16Array {
  const texels = new Uint16Array(TILE_SIZE * TILE_SIZE * TILE_CHANNELS)
  for (const at of opaque)
    texels[(at.y * TILE_SIZE + at.x) * TILE_CHANNELS + 3] = encodeFloat16(0.5)
  return texels
}

describe("coveredBounds", () => {
  test("is null for tiles holding nothing", () => {
    expect(coveredBounds([{ x: 0, y: 0, texels: tile([]) }])).toBeNull()
    expect(coveredBounds([])).toBeNull()
  })

  test("is the tight box round every pixel with any alpha", () => {
    const bounds = coveredBounds([
      { x: 0, y: 0, texels: tile([{ x: 10, y: 20 }]) },
      { x: 1, y: 0, texels: tile([{ x: 5, y: 30 }]) },
    ])
    expect(bounds).toEqual({
      x: 10,
      y: 20,
      width: TILE_SIZE + 5 - 10 + 1,
      height: 11,
    })
  })

  test("ignores a negative zero alpha", () => {
    const texels = tile([])
    texels[3] = 0x8000
    expect(coveredBounds([{ x: 0, y: 0, texels }])).toBeNull()
  })
})

describe("layerStartPlacement", () => {
  test("describes the content box unturned, and draws it where it already is", () => {
    const region = { x: 10, y: 20, width: 40, height: 30 }
    const placement = layerStartPlacement(region)
    expect(placement).toEqual({
      x: 30,
      y: 35,
      width: 40,
      height: 30,
      rotation: 0,
      flipX: false,
      flipY: false,
    })
    // The source is the region itself, so its own origin lands on the
    // region's: picking a layer up moves nothing.
    expect(
      sameAffine(affineFromPlacement(placement, region), [
        1,
        0,
        0,
        1,
        region.x,
        region.y,
      ])
    ).toBe(true)
  })
})
