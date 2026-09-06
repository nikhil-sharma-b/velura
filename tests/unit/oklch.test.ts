import { describe, expect, test } from "bun:test"

import {
  displayTransform,
  srgbToWorking,
  decodeTransfer,
} from "@/engine/color/display-transform"
import {
  clampChromaToSrgb,
  formatHex,
  maxSrgbChroma,
  hexToWorking,
  isSrgbDisplayable,
  oklchToWorking,
  parseHex,
  workingToHex,
  workingToOklch,
} from "@/engine/color/oklch"

const near = (a: number, b: number, tolerance = 1e-4) =>
  expect(Math.abs(a - b)).toBeLessThan(tolerance)

describe("hex parsing", () => {
  test("accepts the shapes an artist actually types", () => {
    expect(parseHex("#1a2b3c")).toEqual([0x1a / 255, 0x2b / 255, 0x3c / 255])
    expect(parseHex("1A2B3C")).toEqual([0x1a / 255, 0x2b / 255, 0x3c / 255])
    expect(parseHex("  #abc ")).toEqual([0xaa / 255, 0xbb / 255, 0xcc / 255])
  })

  test("rejects what is not a colour", () => {
    for (const bad of ["", "#", "#12", "#12345", "#gggggg", "#1234567"])
      expect(parseHex(bad)).toBeNull()
  })

  test("formats back to a canonical lowercase six-digit hex", () => {
    expect(formatHex([0x1a / 255, 0x2b / 255, 0x3c / 255])).toBe("#1a2b3c")
    expect(formatHex([0, 0, 0])).toBe("#000000")
    expect(formatHex([1, 1, 1])).toBe("#ffffff")
    // Out of range is clipped, never wrapped.
    expect(formatHex([-1, 2, 0.5])).toBe("#00ff80")
  })
})

describe("hex against the engine's working space", () => {
  test("every 8-bit grey round-trips exactly", () => {
    for (let value = 0; value < 256; value++) {
      const hex = formatHex([value / 255, value / 255, value / 255])
      expect(workingToHex(hexToWorking(hex))).toBe(hex)
    }
  })

  test("saturated primaries and secondaries round-trip exactly", () => {
    for (const hex of [
      "#ff0000",
      "#00ff00",
      "#0000ff",
      "#ffff00",
      "#00ffff",
      "#ff00ff",
      "#7f3ba2",
      "#c08a4d",
    ])
      expect(workingToHex(hexToWorking(hex))).toBe(hex)
  })

  test("hex lands in linear P3 by the same route the display transform reverses", () => {
    const working = hexToWorking("#c08a4d")
    const expected = srgbToWorking([
      decodeTransfer(0xc0 / 255),
      decodeTransfer(0x8a / 255),
      decodeTransfer(0x4d / 255),
    ])
    working.forEach((channel, index) => near(channel, expected[index]))
    // And presenting it to an sRGB output gives the hex back.
    const encoded = displayTransform(working, "srgb")
    expect(formatHex(encoded)).toBe("#c08a4d")
  })
})

describe("OKLCH", () => {
  test("round-trips through the working space", () => {
    for (const hex of ["#000000", "#ffffff", "#ff0000", "#3d7ac2", "#c08a4d"]) {
      const working = hexToWorking(hex)
      const back = oklchToWorking(workingToOklch(working))
      back.forEach((channel, index) => near(channel, working[index], 1e-5))
    }
  })

  test("greys have no chroma, and white is lightness one", () => {
    const white = workingToOklch(hexToWorking("#ffffff"))
    near(white.lightness, 1, 1e-3)
    near(white.chroma, 0, 1e-3)
    const grey = workingToOklch(hexToWorking("#808080"))
    near(grey.chroma, 0, 1e-3)
    expect(grey.lightness).toBeLessThan(white.lightness)
  })

  test("lightness moves perceptually: equal steps read as equal steps", () => {
    // The sRGB ramp is famously uneven; OKLCH lightness is not. Mid-grey sits
    // near the middle of the lightness range, which 0.5 in sRGB does not.
    const mid = workingToOklch(hexToWorking("#777777")).lightness
    expect(mid).toBeGreaterThan(0.45)
    expect(mid).toBeLessThan(0.58)
  })

  test("hue is an angle in degrees, and survives a lightness change", () => {
    const red = workingToOklch(hexToWorking("#ff0000"))
    expect(red.hue).toBeGreaterThanOrEqual(0)
    expect(red.hue).toBeLessThan(360)
    const lighter = workingToOklch(
      oklchToWorking({ ...red, lightness: red.lightness + 0.1 })
    )
    near(lighter.hue, red.hue, 1e-3)
    near(lighter.chroma, red.chroma, 1e-3)
  })
})

describe("fitting a colour into what hex can say", () => {
  test("recognises colours sRGB cannot hold", () => {
    expect(isSrgbDisplayable(hexToWorking("#ff0000"))).toBe(true)
    // Far outside any real gamut.
    expect(
      isSrgbDisplayable(
        oklchToWorking({ lightness: 0.6, chroma: 0.4, hue: 150 })
      )
    ).toBe(false)
  })

  test("clamping keeps hue and lightness and only gives up chroma", () => {
    const wanted = { lightness: 0.6, chroma: 0.4, hue: 150 }
    const fitted = clampChromaToSrgb(wanted)
    expect(fitted.chroma).toBeLessThan(wanted.chroma)
    near(fitted.lightness, wanted.lightness, 1e-9)
    near(fitted.hue, wanted.hue, 1e-9)
    expect(isSrgbDisplayable(oklchToWorking(fitted))).toBe(true)
  })

  test("a colour already inside the gamut is left alone", () => {
    const inside = workingToOklch(hexToWorking("#3d7ac2"))
    expect(clampChromaToSrgb(inside).chroma).toBeCloseTo(inside.chroma, 6)
  })
})

describe("saturation as a fraction of what the hue can hold", () => {
  test("black and white hold next to no chroma", () => {
    // The gamut pinches to a point at both ends, so what is left there is
    // numerically small and visually nothing: full saturation on a black is
    // still black.
    expect(maxSrgbChroma(0, 120)).toBeLessThan(0.05)
    expect(maxSrgbChroma(1, 120)).toBeLessThan(0.05)
    expect(
      workingToHex(
        oklchToWorking({
          lightness: 0,
          chroma: maxSrgbChroma(0, 120),
          hue: 120,
        })
      )
    ).toBe("#000000")
  })

  test("every hue reaches full saturation at its own ceiling", () => {
    for (let hue = 0; hue < 360; hue += 15) {
      const ceiling = maxSrgbChroma(0.65, hue)
      expect(ceiling).toBeGreaterThan(0)
      expect(
        isSrgbDisplayable(
          oklchToWorking({ lightness: 0.65, chroma: ceiling, hue })
        )
      ).toBe(true)
      // And it really is the ceiling: a little more falls out of gamut.
      expect(
        isSrgbDisplayable(
          oklchToWorking({ lightness: 0.65, chroma: ceiling + 0.02, hue })
        )
      ).toBe(false)
    }
  })

  test("ceilings differ by hue, which is why saturation is a fraction of one", () => {
    // Yellow holds far less chroma than blue at the same lightness.
    expect(maxSrgbChroma(0.65, 264)).toBeGreaterThan(maxSrgbChroma(0.65, 110))
  })
})
