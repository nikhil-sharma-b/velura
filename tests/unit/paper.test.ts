import { describe, expect, test } from "bun:test"

import { PAPER_SIZE, paperHeights } from "../../engine/gpu/paper"

/**
 * The paper every fluid brush paints on (fluid brushes 07): one procedural
 * height texture, an engine constant. It is the same paper each time it is
 * made, it has both valleys and peaks, and it tiles across the document
 * without a seam.
 */
describe("paper", () => {
  const heights = paperHeights()
  const at = (x: number, y: number) =>
    heights[(y % PAPER_SIZE) * PAPER_SIZE + (x % PAPER_SIZE)]

  test("is a square of bytes whose side is a power of two", () => {
    expect(heights).toBeInstanceOf(Uint8Array)
    expect(heights.length).toBe(PAPER_SIZE * PAPER_SIZE)
    expect(PAPER_SIZE & (PAPER_SIZE - 1)).toBe(0)
  })

  test("is the same paper every time it is made", () => {
    expect(paperHeights()).toEqual(heights)
  })

  test("has valleys and peaks about a middle height", () => {
    let sum = 0
    let low = 0
    let high = 0
    for (const height of heights) {
      sum += height
      if (height < 64) low++
      if (height > 192) high++
    }
    const mean = sum / heights.length
    expect(mean).toBeGreaterThan(112)
    expect(mean).toBeLessThan(144)
    // Neither is a rarity: a wash has both to granulate into.
    expect(low).toBeGreaterThan(heights.length * 0.02)
    expect(high).toBeGreaterThan(heights.length * 0.02)
  })

  test("tiles without a seam", () => {
    // The step from the last pixel to the first is no larger than the steps
    // between neighbours anywhere else.
    let within = 0
    let across = 0
    for (let i = 0; i < PAPER_SIZE; i++) {
      for (let j = 0; j < PAPER_SIZE - 1; j++) {
        within = Math.max(within, Math.abs(at(j, i) - at(j + 1, i)))
        within = Math.max(within, Math.abs(at(i, j) - at(i, j + 1)))
      }
      across = Math.max(across, Math.abs(at(PAPER_SIZE - 1, i) - at(0, i)))
      across = Math.max(across, Math.abs(at(i, PAPER_SIZE - 1) - at(i, 0)))
    }
    expect(across).toBeLessThanOrEqual(within)
  })

  test("has grain finer than a cell of the simulation", () => {
    // Two pixels of one cell are not always at one height.
    let differing = 0
    for (let y = 0; y < PAPER_SIZE; y += 2)
      for (let x = 0; x < PAPER_SIZE; x += 2)
        if (Math.abs(at(x, y) - at(x + 1, y)) > 8) differing++
    expect(differing).toBeGreaterThan(heights.length / 4 / 4)
  })
})
