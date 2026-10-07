import { describe, expect, test } from "bun:test"
import { PNG } from "pngjs"

import { decodeGrayPng } from "@/engine/brush/gray-png"

/** A greyscale PNG as the asset pipeline writes one. */
function encode(width: number, height: number, data: Uint8Array): Uint8Array {
  return new Uint8Array(
    PNG.sync.write(
      Object.assign(new PNG({ width, height }), {
        data: Buffer.from(
          Array.from(data).flatMap((value) => [value, value, value, 255])
        ),
      }),
      { colorType: 0, inputColorType: 6, bitDepth: 8 }
    )
  )
}

describe("a shipped greyscale texture", () => {
  test("decodes to exactly the bytes that were encoded", async () => {
    const width = 37
    const height = 23
    // Gradients and noise together, so the encoder's filter heuristic picks
    // more than one of the five row filters along the way.
    const data = new Uint8Array(width * height)
    let seed = 7
    for (let i = 0; i < data.length; i++) {
      seed = (seed * 1103515245 + 12345) >>> 0
      data[i] = i % 3 === 0 ? (i * 5) & 255 : seed >>> 24
    }
    expect(await decodeGrayPng(encode(width, height, data))).toEqual({
      width,
      height,
      data,
    })
  })

  test("refuses a PNG that is not single-channel 8-bit", async () => {
    const rgba = new Uint8Array(
      PNG.sync.write(
        Object.assign(new PNG({ width: 1, height: 1 }), {
          data: Buffer.from([1, 2, 3, 255]),
        })
      )
    )
    await expect(decodeGrayPng(rgba)).rejects.toThrow()
  })

  test("refuses a PNG cut short, rather than reading past its end", async () => {
    const whole = encode(4, 4, new Uint8Array(16))
    await expect(decodeGrayPng(whole.slice(0, 40))).rejects.toThrow(
      "could not be decoded"
    )
  })

  test("refuses bytes that are not a PNG", async () => {
    await expect(decodeGrayPng(new Uint8Array([1, 2, 3]))).rejects.toThrow()
  })
})
