import { describe, expect, test } from "bun:test"
import {
  chooseOutputColorSpace,
  displayTransform,
  encodeTransfer,
  srgbToWorking,
  workingToOutputMatrix,
} from "../../engine/color/display-transform"

const close = (actual: number, expected: number, epsilon = 1e-4) =>
  expect(Math.abs(actual - expected)).toBeLessThan(epsilon)

describe("choosing the output colour space", () => {
  test("uses the display's wide gamut when it has one", () => {
    expect(
      chooseOutputColorSpace({ displaySupportsP3: true, gpuSupportsP3: true })
    ).toBe("display-p3")
  })

  test("falls back to sRGB on a narrow-gamut display", () => {
    expect(
      chooseOutputColorSpace({ displaySupportsP3: false, gpuSupportsP3: true })
    ).toBe("srgb")
  })

  test("falls back to sRGB when the swap chain cannot present P3", () => {
    expect(
      chooseOutputColorSpace({ displaySupportsP3: true, gpuSupportsP3: false })
    ).toBe("srgb")
  })
})

describe("transfer function", () => {
  test("black and white are fixed points", () => {
    close(encodeTransfer(0), 0)
    close(encodeTransfer(1), 1)
  })

  test("mid linear light encodes to the familiar sRGB midtone", () => {
    close(encodeTransfer(0.5), 0.735357)
  })

  test("the near-black segment is the linear one", () => {
    close(encodeTransfer(0.002), 0.002 * 12.92)
  })

  test("out-of-gamut values are clipped rather than mirrored", () => {
    expect(encodeTransfer(-0.4)).toBe(0)
    close(encodeTransfer(1.7), 1)
  })
})

describe("working space to output primaries", () => {
  test("P3 output needs no primary conversion: the working space is P3", () => {
    expect(workingToOutputMatrix("display-p3")).toEqual([
      1, 0, 0, 0, 1, 0, 0, 0, 1,
    ])
  })

  test("sRGB output leaves neutrals neutral", () => {
    const [r, g, b] = displayTransform([0.5, 0.5, 0.5], "srgb")
    close(r, encodeTransfer(0.5))
    close(g, encodeTransfer(0.5))
    close(b, encodeTransfer(0.5))
  })

  test("a P3 primary is brighter than full sRGB and clips on fallback", () => {
    const wide = displayTransform([0, 1, 0], "display-p3")
    const narrow = displayTransform([0, 1, 0], "srgb")
    close(wide[0], 0)
    close(wide[1], 1)
    close(wide[2], 0)
    // Pure P3 green lies outside sRGB: it clips to green with negative
    // red and blue pulled back to zero.
    close(narrow[1], 1)
    expect(narrow[0]).toBe(0)
    expect(narrow[2]).toBe(0)
  })

  test("an sRGB colour round-trips through the working space unchanged", () => {
    const srgbLinear = [0.2140411, 0.0865, 0.0217] as const
    const working = srgbToWorking(srgbLinear)
    const [r, g, b] = displayTransform(working, "srgb")
    close(r, encodeTransfer(srgbLinear[0]))
    close(g, encodeTransfer(srgbLinear[1]))
    close(b, encodeTransfer(srgbLinear[2]))
  })
})
