import { describe, expect, test } from "bun:test"
import { decodeTile, encodeTile } from "../../engine/store/tile-codec"
import { encodeFloat16 } from "../../engine/doc/float16"
import { TILE_CHANNELS, TILE_TEXELS } from "../../engine/doc/tile-grid"

const TILE_VALUES = TILE_TEXELS * TILE_CHANNELS

/** Texels no image format has a place for: HDR, negative, subnormal, NaN. */
function awkwardTile(): Uint16Array {
  const values = [
    0, 1, 0x3c00, 0x7bff, 0xfbff, 0x03ff, 0x0001, 0x8000, 0x7c00, 0x7e00,
  ]
  const texels = new Uint16Array(TILE_VALUES)
  for (let i = 0; i < texels.length; i++) texels[i] = values[i % values.length]
  return texels
}

describe("tile blobs", () => {
  test("a tile round-trips byte for byte", async () => {
    const texels = awkwardTile()
    const decoded = await decodeTile(await encodeTile(texels))
    expect(decoded).toEqual(texels)
  })

  test("wide-gamut and above-white values survive", async () => {
    const texels = new Uint16Array(TILE_VALUES)
    for (let i = 0; i < texels.length; i++)
      texels[i] = encodeFloat16((i % 97) / 13 - 2)
    const decoded = await decodeTile(await encodeTile(texels))
    expect(decoded).toEqual(texels)
  })

  test("a blank tile compresses to a fraction of its size", async () => {
    const blob = await encodeTile(new Uint16Array(TILE_VALUES))
    expect(blob.length).toBeLessThan(TILE_VALUES * 2 * 0.01)
  })

  test("bytes that are not a tile blob are refused", async () => {
    expect(decodeTile(new Uint8Array(32))).rejects.toThrow(/not a tile blob/)
  })

  test("a truncated blob is refused rather than half-decoded", async () => {
    const blob = await encodeTile(awkwardTile())
    expect(decodeTile(blob.subarray(0, 4))).rejects.toThrow(/truncated/)
  })
})
