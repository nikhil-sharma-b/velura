import { describe, expect, test } from "bun:test"

import { previewSize } from "../../engine/store/preview"

describe("preview sizing", () => {
  test("fits landscape and portrait documents inside the preview edge", () => {
    expect(previewSize(2000, 1000)).toEqual({ width: 512, height: 256 })
    expect(previewSize(1000, 2000)).toEqual({ width: 256, height: 512 })
  })

  test("does not enlarge a small document", () => {
    expect(previewSize(120, 80)).toEqual({ width: 120, height: 80 })
  })
})
