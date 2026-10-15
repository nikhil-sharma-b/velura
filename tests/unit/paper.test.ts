import { describe, expect, test } from "bun:test"

import { PAPERS } from "../../engine/doc/paper"
import { PAPER_SIZE, paperHeights } from "../../engine/gpu/paper"

/**
 * The paper every fluid brush paints on (fluid brushes 07): a procedural
 * height texture, one of a few the document chooses from (15). It is the
 * same paper each time it is made, it has both valleys and peaks, and it
 * tiles across the document without a seam.
 */
describe("paper", () => {
  const heights = paperHeights("cold-press")
  const at = (x: number, y: number) =>
    heights[(y % PAPER_SIZE) * PAPER_SIZE + (x % PAPER_SIZE)]

  test("is a square of bytes whose side is a power of two", () => {
    expect(heights).toBeInstanceOf(Uint8Array)
    expect(heights.length).toBe(PAPER_SIZE * PAPER_SIZE)
    expect(PAPER_SIZE & (PAPER_SIZE - 1)).toBe(0)
  })

  test("is the same paper every time it is made", () => {
    expect(paperHeights("cold-press")).toEqual(heights)
  })

  test("cold press is the paper there was before a document could choose", () => {
    // The digest of `paperHeights()` as fluid brushes 07 to 14 left it, so
    // documents and the built-in fluid brushes look as they did.
    const digest = new Bun.CryptoHasher("sha256").update(heights).digest("hex")
    expect(digest).toBe(
      "b84ed82f23a8dbf76c9f39b94c5f813ea514b939189b3537dfe7235a7d0069d8"
    )
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

  test("has grain finer than a cell of the simulation", () => {
    // Two pixels of one cell are not always at one height.
    let differing = 0
    for (let y = 0; y < PAPER_SIZE; y += 2)
      for (let x = 0; x < PAPER_SIZE; x += 2)
        if (Math.abs(at(x, y) - at(x + 1, y)) > 8) differing++
    expect(differing).toBeGreaterThan(heights.length / 4 / 4)
  })
})

/** Every paper a document can choose (15). */
describe.each([...PAPERS])("%s", (paper) => {
  const heights = paperHeights(paper)
  const at = (x: number, y: number) =>
    heights[(y % PAPER_SIZE) * PAPER_SIZE + (x % PAPER_SIZE)]

  test("is a square of bytes, the same each time it is made", () => {
    expect(heights.length).toBe(PAPER_SIZE * PAPER_SIZE)
    expect(paperHeights(paper)).toEqual(heights)
  })

  test("tiles without a seam", () => {
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
})

describe("the papers against each other", () => {
  /** How far heights spread about their mean, in bytes. */
  const spread = (heights: Uint8Array) => {
    let sum = 0
    for (const height of heights) sum += height
    const mean = sum / heights.length
    let variance = 0
    for (const height of heights) variance += (height - mean) ** 2
    return Math.sqrt(variance / heights.length)
  }
  /**
   * How alike two pixels `lag` apart along a row are: their correlation.
   * Coarse grain keeps it high further out than fine grain does.
   */
  const correlation = (heights: Uint8Array, lag: number) => {
    let sum = 0
    for (const height of heights) sum += height
    const mean = sum / heights.length
    let together = 0
    let alone = 0
    for (let y = 0; y < PAPER_SIZE; y++)
      for (let x = 0; x < PAPER_SIZE; x++) {
        const a = heights[y * PAPER_SIZE + x] - mean
        const b = heights[y * PAPER_SIZE + ((x + lag) % PAPER_SIZE)] - mean
        together += a * b
        alone += a * a
      }
    return together / alone
  }
  const hot = paperHeights("hot-press")
  const cold = paperHeights("cold-press")
  const rough = paperHeights("rough")

  test("are three different papers", () => {
    expect(PAPERS).toEqual(["hot-press", "cold-press", "rough"])
    expect(hot).not.toEqual(cold)
    expect(rough).not.toEqual(cold)
  })

  test("run from smooth to rough in relief", () => {
    expect(spread(cold)).toBeGreaterThan(spread(hot) * 1.2)
    expect(spread(rough)).toBeGreaterThan(spread(cold) * 1.2)
  })

  test("run from fine to coarse in grain", () => {
    const LAG = 6
    expect(correlation(cold, LAG)).toBeGreaterThan(correlation(hot, LAG) + 0.1)
    expect(correlation(rough, LAG)).toBeGreaterThan(
      correlation(cold, LAG) + 0.1
    )
  })
})
