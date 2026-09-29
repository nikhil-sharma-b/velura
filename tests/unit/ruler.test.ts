import { describe, expect, test } from "bun:test"

import { rulerStep, rulerTicks } from "../../features/studio/lib/ruler"

describe("ruler spacing", () => {
  test("labels land at a round document step at least the minimum apart", () => {
    // One document pixel per CSS pixel, labels at least 50 apart: 50.
    expect(rulerStep(1, 50)).toBe(50)
    // Zoomed in 10x: 5 document pixels is 50 CSS pixels.
    expect(rulerStep(10, 50)).toBe(5)
    // Zoomed out to a quarter: 200 document pixels is 50 CSS pixels.
    expect(rulerStep(0.25, 50)).toBe(200)
    // Steps are 1, 2 or 5 times a power of ten.
    expect(rulerStep(1, 60)).toBe(100)
    expect(rulerStep(3, 50)).toBe(20)
  })
})

describe("ruler ticks", () => {
  test("a ruler along an unturned view reads document pixels from its origin", () => {
    // Screen 0 is document 100; each CSS pixel is half a document pixel.
    const ticks = rulerTicks((s) => 100 + s / 2, 200, 50)
    // Zoom 2 → step 50 → labels at doc 100, 150, 200 → screen 0, 100, 200.
    expect(ticks.map((t) => [t.value, t.at])).toEqual([
      [100, 0],
      [150, 100],
      [200, 200],
    ])
  })

  test("a flipped ruler still finds every label in view", () => {
    const ticks = rulerTicks((s) => 100 - s, 120, 50)
    expect(ticks.map((t) => [t.value, t.at])).toEqual([
      [100, 0],
      [50, 50],
      [0, 100],
    ])
  })

  test("a ruler that reads no change has nothing to show", () => {
    expect(rulerTicks(() => 3, 100, 50)).toEqual([])
  })
})
