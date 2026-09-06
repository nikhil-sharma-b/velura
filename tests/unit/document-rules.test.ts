import { describe, expect, test } from "bun:test"

import {
  canvasSizeProblem,
  DEFAULT_DOCUMENT_NAME,
  duplicateName,
  MAX_CANVAS_SIZE,
  MAX_DOCUMENT_NAME_LENGTH,
  normaliseDocumentName,
} from "@/convex/lib/documents"

describe("canvas size", () => {
  test("accepts a size inside the engine's texture limit", () => {
    expect(canvasSizeProblem(2048, 3508)).toBeNull()
    expect(canvasSizeProblem(MAX_CANVAS_SIZE, MAX_CANVAS_SIZE)).toBeNull()
  })

  test("rejects a size past the limit, naming the offending axis", () => {
    expect(canvasSizeProblem(MAX_CANVAS_SIZE + 1, 512)).toContain("Width")
    expect(canvasSizeProblem(512, MAX_CANVAS_SIZE + 1)).toContain("Height")
  })

  test("rejects sizes that are too small or not whole pixels", () => {
    expect(canvasSizeProblem(0, 512)).not.toBeNull()
    expect(canvasSizeProblem(512, -1)).not.toBeNull()
    expect(canvasSizeProblem(512.5, 512)).toContain("whole number")
    expect(canvasSizeProblem(512, Number.NaN)).not.toBeNull()
  })
})

describe("document names", () => {
  test("collapses whitespace and falls back when blank", () => {
    expect(normaliseDocumentName("  Sea   study ")).toBe("Sea study")
    expect(normaliseDocumentName("   ")).toBe(DEFAULT_DOCUMENT_NAME)
  })

  test("caps length so one row cannot swallow the library list", () => {
    expect(normaliseDocumentName("x".repeat(500))).toHaveLength(
      MAX_DOCUMENT_NAME_LENGTH
    )
  })
})

describe("duplicate naming", () => {
  test("suffixes the first copy", () => {
    expect(duplicateName("Sea study", ["Sea study"])).toBe("Sea study copy")
  })

  test("counts up instead of stacking the word copy", () => {
    expect(
      duplicateName("Sea study copy", ["Sea study", "Sea study copy"])
    ).toBe("Sea study copy 2")
    expect(
      duplicateName("Sea study copy 2", [
        "Sea study",
        "Sea study copy",
        "Sea study copy 2",
      ])
    ).toBe("Sea study copy 3")
  })
})
