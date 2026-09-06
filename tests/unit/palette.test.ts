import { describe, expect, test } from "bun:test"

import {
  MAX_PALETTE_COLORS,
  MAX_PALETTE_NAME_LENGTH,
  RECENT_LIMIT,
  moveColor,
  normalisePaletteName,
  normaliseSwatch,
  paletteProblem,
  recordRecent,
} from "@/convex/lib/palette"

describe("swatches", () => {
  test("normalise to canonical lowercase hex", () => {
    expect(normaliseSwatch("#AABBCC")).toBe("#aabbcc")
    expect(normaliseSwatch(" abc ")).toBe("#aabbcc")
  })

  test("anything that is not a colour is rejected", () => {
    for (const bad of ["", "red", "#12345", "rgb(1,2,3)"])
      expect(normaliseSwatch(bad)).toBeNull()
  })
})

describe("recently used colours", () => {
  test("the newest is first", () => {
    expect(recordRecent([], "#ff0000")).toEqual(["#ff0000"])
    expect(recordRecent(["#ff0000"], "#00ff00")).toEqual(["#00ff00", "#ff0000"])
  })

  test("re-using a colour moves it to the front rather than duplicating it", () => {
    const recent = ["#0000ff", "#00ff00", "#ff0000"]
    expect(recordRecent(recent, "#FF0000")).toEqual([
      "#ff0000",
      "#0000ff",
      "#00ff00",
    ])
  })

  test("the list is bounded, dropping the oldest", () => {
    let recent: string[] = []
    for (let index = 0; index < RECENT_LIMIT + 5; index++)
      recent = recordRecent(
        recent,
        `#0000${index.toString(16).padStart(2, "0")}`
      )
    expect(recent).toHaveLength(RECENT_LIMIT)
    expect(recent[0]).toBe(
      `#0000${(RECENT_LIMIT + 4).toString(16).padStart(2, "0")}`
    )
  })

  test("a colour that is not a colour is not recorded", () => {
    expect(recordRecent(["#ff0000"], "nonsense")).toEqual(["#ff0000"])
  })

  test("the original list is never mutated", () => {
    const recent = ["#ff0000"]
    recordRecent(recent, "#00ff00")
    expect(recent).toEqual(["#ff0000"])
  })
})

describe("reordering a palette", () => {
  const colors = ["#111111", "#222222", "#333333", "#444444"]

  test("moves a colour to a position counted in the result", () => {
    expect(moveColor(colors, 0, 2)).toEqual([
      "#222222",
      "#333333",
      "#111111",
      "#444444",
    ])
    expect(moveColor(colors, 3, 0)).toEqual([
      "#444444",
      "#111111",
      "#222222",
      "#333333",
    ])
  })

  test("out-of-range positions are clamped, not errors", () => {
    expect(moveColor(colors, 0, 99)).toEqual([
      "#222222",
      "#333333",
      "#444444",
      "#111111",
    ])
    expect(moveColor(colors, 2, -3)).toEqual([
      "#333333",
      "#111111",
      "#222222",
      "#444444",
    ])
  })

  test("moving a colour that is not there leaves the palette alone", () => {
    expect(moveColor(colors, 9, 0)).toEqual(colors)
  })
})

describe("palette names and limits", () => {
  test("names are trimmed and collapsed", () => {
    expect(normalisePaletteName("  Autumn   study ")).toBe("Autumn study")
  })

  test("an empty name falls back rather than saving a nameless palette", () => {
    expect(normalisePaletteName("   ")).toBe("Untitled palette")
  })

  test("names are bounded", () => {
    expect(normalisePaletteName("x".repeat(500))).toHaveLength(
      MAX_PALETTE_NAME_LENGTH
    )
  })

  test("a palette that is too long is refused with a reason", () => {
    expect(
      paletteProblem(new Array(MAX_PALETTE_COLORS).fill("#ffffff"))
    ).toBeNull()
    expect(
      paletteProblem(new Array(MAX_PALETTE_COLORS + 1).fill("#ffffff"))
    ).toContain(String(MAX_PALETTE_COLORS))
    expect(paletteProblem(["not a colour"])).toContain("not a colour")
  })
})
