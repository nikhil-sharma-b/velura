import { describe, expect, test } from "bun:test"

import {
  boardDown,
  FLAT_BOARD,
  isFlat,
  normaliseBoard,
  sameBoard,
} from "../../engine/doc/board"

describe("the board (fluid brushes 38)", () => {
  test("down is the paper's bottom edge at 0°, and turns clockwise", () => {
    const at = (direction: number) => {
      const { x, y } = boardDown({ steepness: 1, direction })
      // Plus zero, so a -0 reads as the 0 it is.
      return [Math.round(x * 1e6) / 1e6 + 0, Math.round(y * 1e6) / 1e6 + 0]
    }
    expect(at(0)).toEqual([0, 1])
    expect(at(90)).toEqual([-1, 0])
    expect(at(180)).toEqual([0, -1])
    expect(at(270)).toEqual([1, 0])
  })

  test("a board with no steepness is flat, whichever way it points", () => {
    expect(isFlat(FLAT_BOARD)).toBe(true)
    expect(isFlat({ steepness: 0, direction: 90 })).toBe(true)
    expect(isFlat({ steepness: 0.01, direction: 0 })).toBe(false)
    expect(
      sameBoard({ steepness: 0, direction: 90 }, { steepness: 0, direction: 0 })
    ).toBe(true)
    expect(
      sameBoard(
        { steepness: 0.5, direction: 90 },
        { steepness: 0.5, direction: 0 }
      )
    ).toBe(false)
  })

  test("anything that is not a board opens flat", () => {
    for (const raw of [
      undefined,
      null,
      "steep",
      7,
      {},
      { steepness: "1", direction: 0 },
      { steepness: 1 },
      { steepness: Number.NaN, direction: 0 },
      { steepness: 1, direction: Number.POSITIVE_INFINITY },
    ])
      expect(normaliseBoard(raw)).toEqual(FLAT_BOARD)
  })

  test("a steepness past either end is held to it, and a direction turned into [0, 360)", () => {
    expect(normaliseBoard({ steepness: 3, direction: 450 })).toEqual({
      steepness: 1,
      direction: 90,
    })
    expect(normaliseBoard({ steepness: -1, direction: 30 })).toEqual(FLAT_BOARD)
    expect(normaliseBoard({ steepness: 0.4, direction: -90 })).toEqual({
      steepness: 0.4,
      direction: 270,
    })
  })
})
