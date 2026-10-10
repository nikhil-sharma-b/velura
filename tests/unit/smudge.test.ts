import { describe, expect, test } from "bun:test"

import {
  DEFAULT_SMUDGE,
  smudgeDabStrength,
  smudgeSpacing,
} from "../../engine/brush/smudge"

describe("a smudge dab's strength", () => {
  test("is the setting's from a device with no force sensor", () => {
    expect(smudgeDabStrength(0.6, 1, false)).toBe(0.6)
    // Whatever such a device claims to press with is not a reading.
    expect(smudgeDabStrength(0.6, 0.5, false)).toBe(0.6)
  })

  test("rises with pen pressure to the setting and no further", () => {
    expect(smudgeDabStrength(0.8, 0.25, true)).toBeCloseTo(0.2)
    expect(smudgeDabStrength(0.8, 1, true)).toBe(0.8)
    expect(smudgeDabStrength(0.8, 4, true)).toBe(0.8)
    expect(smudgeDabStrength(0.8, 0, true)).toBe(0)
    expect(smudgeDabStrength(0.8, -1, true)).toBe(0)
  })
})

describe("smudge spacing", () => {
  test("follows the dab's size, and never closes below a pixel", () => {
    expect(smudgeSpacing(DEFAULT_SMUDGE.radius)).toBe(4)
    expect(smudgeSpacing(64)).toBe(16)
    expect(smudgeSpacing(0.5)).toBe(1)
  })
})
