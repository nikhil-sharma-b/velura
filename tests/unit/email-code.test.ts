import { describe, expect, test } from "bun:test"

import { generateEmailCode } from "@/convex/auth"

describe("the one-time sign-in code", () => {
  test("is eight digits", () => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      expect(generateEmailCode()).toMatch(/^\d{8}$/)
    }
  })

  test("does not favour the digits a modulo fold would bias", () => {
    // Folding a byte with `% 10` makes 0-5 about a fifth likelier than 6-9.
    // Over this many digits that skew is far outside sampling noise, so the
    // test fails if the rejection step is ever dropped.
    const counts = new Array<number>(10).fill(0)
    for (let attempt = 0; attempt < 5000; attempt += 1) {
      for (const digit of generateEmailCode()) counts[Number(digit)] += 1
    }
    const total = counts.reduce((sum, count) => sum + count, 0)
    const expected = total / 10
    for (const count of counts) {
      expect(Math.abs(count - expected) / expected).toBeLessThan(0.08)
    }
  })
})
