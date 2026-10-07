import { describe, expect, test } from "bun:test"

import {
  assetName,
  assetSlug,
  grainFromImage,
  shrinkToFit,
  tipFromImage,
} from "@/tooling/krita-assets/convert"

describe("a shipped tip", () => {
  test("keeps a greyscale brush's bytes, which already are ink", () => {
    const tip = tipFromImage({
      width: 2,
      height: 1,
      channels: 1,
      pixels: new Uint8Array([0, 200]),
    })
    expect(tip.data).toEqual(new Uint8Array([0, 200]))
  })

  test("reads a colour image as a dark mark on paper, as an import does", () => {
    const tip = tipFromImage({
      width: 3,
      height: 1,
      channels: 4,
      // Black, white, and black that is not there at all.
      pixels: new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 0]),
    })
    expect(tip.data).toEqual(new Uint8Array([255, 0, 0]))
  })
})

describe("a shipped paper", () => {
  test("lets ink through where the image is light", () => {
    const grain = grainFromImage({
      width: 2,
      height: 1,
      channels: 1,
      pixels: new Uint8Array([10, 200]),
    })
    expect(grain.data[0]).toBeLessThan(grain.data[1])
  })

  test("is stretched to the full range, so depth means the same on every paper", () => {
    const grain = grainFromImage({
      width: 3,
      height: 1,
      channels: 1,
      pixels: new Uint8Array([100, 120, 140]),
    })
    expect(grain.data).toEqual(new Uint8Array([0, 128, 255]))
  })

  test("reads transparency as paper that lets everything through", () => {
    const grain = grainFromImage({
      width: 2,
      height: 1,
      channels: 2,
      pixels: new Uint8Array([0, 255, 0, 0]),
    })
    expect(grain.data).toEqual(new Uint8Array([0, 255]))
  })

  test("is flat rather than undefined when the image is one tone", () => {
    const grain = grainFromImage({
      width: 2,
      height: 1,
      channels: 1,
      pixels: new Uint8Array([90, 90]),
    })
    expect(grain.data).toEqual(new Uint8Array([255, 255]))
  })
})

describe("an oversized texture", () => {
  test("is halved until it fits, averaging each two by two block", () => {
    const shrunk = shrinkToFit(
      {
        width: 4,
        height: 2,
        data: new Uint8Array([0, 100, 200, 200, 100, 200, 0, 0]),
      },
      2
    )
    expect(shrunk).toEqual({
      width: 2,
      height: 1,
      data: new Uint8Array([100, 100]),
    })
  })

  test("is returned as it is when it already fits", () => {
    const texture = { width: 2, height: 2, data: new Uint8Array(4) }
    expect(shrinkToFit(texture, 512)).toBe(texture)
  })
})

describe("a shipped asset's name", () => {
  test("drops Krita's ordering prefix and reads as words", () => {
    expect(assetName("03_default-paper.png")).toBe("Default paper")
    expect(assetName("02b_WoofTissue.png")).toBe("Woof tissue")
    expect(assetName("chalk_chisel_random.gih")).toBe("Chalk chisel random")
  })

  test("has an id that is stable, lower case and URL safe", () => {
    expect(assetSlug("03_default-paper.png")).toBe("03-default-paper")
    expect(assetSlug("Cross01.pat")).toBe("cross01")
    expect(assetSlug("leaves-scattered.svg")).toBe("leaves-scattered")
  })
})
