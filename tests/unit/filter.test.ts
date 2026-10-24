import { describe, expect, test } from "bun:test"
import {
  blurKernel,
  defaultFilter,
  isIdentityFilter,
  normalizeFilter,
} from "../../engine/filters/filter"

describe("filter parameters", () => {
  test("each filter starts at the settings that change nothing", () => {
    for (const kind of ["hsl", "brightnessContrast", "blur"] as const)
      expect(isIdentityFilter(defaultFilter(kind))).toBe(true)
  })

  test("a moved setting is not the identity", () => {
    expect(isIdentityFilter({ ...defaultFilter("hsl"), hue: 30 })).toBe(false)
    expect(
      isIdentityFilter({ ...defaultFilter("brightnessContrast"), contrast: 10 })
    ).toBe(false)
    expect(isIdentityFilter({ kind: "blur", radius: 2 })).toBe(false)
  })

  test("settings are clamped to their ranges and junk falls back", () => {
    expect(
      normalizeFilter({
        kind: "hsl",
        hue: 400,
        saturation: -150,
        lightness: NaN,
      })
    ).toEqual({ kind: "hsl", hue: 180, saturation: -100, lightness: 0 })
    expect(
      normalizeFilter({
        kind: "brightnessContrast",
        brightness: 200,
        contrast: -1e9,
      })
    ).toEqual({ kind: "brightnessContrast", brightness: 100, contrast: -100 })
    expect(normalizeFilter({ kind: "blur", radius: -3 })).toEqual({
      kind: "blur",
      radius: 0,
    })
    expect(normalizeFilter({ kind: "blur", radius: 1e6 }).radius).toBe(100)
  })
})

describe("blur kernel", () => {
  test("is one tap per pixel of radius plus the centre, summing to one both ways", () => {
    const kernel = blurKernel(5)
    expect(kernel.length).toBe(6)
    let sum = kernel[0]
    for (let i = 1; i < kernel.length; i++) sum += 2 * kernel[i]
    expect(sum).toBeCloseTo(1, 6)
  })

  test("falls away from the centre", () => {
    const kernel = blurKernel(8)
    for (let i = 1; i < kernel.length; i++)
      expect(kernel[i]).toBeLessThan(kernel[i - 1])
  })

  test("a zero radius is the identity", () => {
    expect(Array.from(blurKernel(0))).toEqual([1])
  })

  test("a fractional radius rounds its reach up", () => {
    expect(blurKernel(2.5).length).toBe(4)
  })
})
