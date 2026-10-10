import { describe, expect, test } from "bun:test"
import { DEFAULT_SHAPE_STYLE, toolShapeStyle } from "../../engine"

describe("what a tool gives a new shape", () => {
  test("a line or a brush stroke is outlined, never filled", () => {
    for (const tool of ["line", "pressure"] as const) {
      const style = toolShapeStyle(tool, DEFAULT_SHAPE_STYLE)
      expect(style.fill).toBe(false)
      expect(style.stroke).toBe(true)
      expect(style.strokeWidth).toBe(DEFAULT_SHAPE_STYLE.strokeWidth)
    }
  })

  test("a new shape is opaque until the artist says otherwise, and a line keeps the opacity", () => {
    expect(DEFAULT_SHAPE_STYLE.opacity).toBe(1)
    expect(
      toolShapeStyle("line", { ...DEFAULT_SHAPE_STYLE, opacity: 0.3 }).opacity
    ).toBe(0.3)
  })

  test("a shape tool takes the style as it is", () => {
    expect(toolShapeStyle("rectangle", DEFAULT_SHAPE_STYLE)).toBe(
      DEFAULT_SHAPE_STYLE
    )
  })

  test("an outline-only style is kept as it is for a line", () => {
    const outlined = { ...DEFAULT_SHAPE_STYLE, fill: false, stroke: true }
    expect(toolShapeStyle("line", outlined)).toBe(outlined)
  })
})
