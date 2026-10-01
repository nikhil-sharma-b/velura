import { describe, expect, test } from "bun:test"

import {
  assistLine,
  createStrokeAssist,
  edgeLine,
  projectOntoLine,
} from "../../engine/geom/stroke-assist"

const close = (actual: { x: number; y: number }, x: number, y: number) => {
  expect(actual.x).toBeCloseTo(x, 6)
  expect(actual.y).toBeCloseTo(y, 6)
}

describe("projection onto a line", () => {
  test("a point is dropped perpendicular onto the line", () => {
    const line = edgeLine({ x: 0, y: 0, angle: 0 })
    close(projectOntoLine(line, 30, 12), 30, 0)
  })

  test("an angled line keeps the component along it", () => {
    const line = edgeLine({ x: 10, y: 10, angle: Math.PI / 4 })
    // (20, 10) is 10 along x from the anchor: √50 along the diagonal.
    close(projectOntoLine(line, 20, 10), 15, 15)
  })

  test("a point already on the line stays put", () => {
    const line = edgeLine({ x: 5, y: -3, angle: 1.1 })
    const on = { x: 5 + Math.cos(1.1) * 40, y: -3 + Math.sin(1.1) * 40 }
    close(projectOntoLine(line, on.x, on.y), on.x, on.y)
  })
})

describe("choosing the line a stroke follows", () => {
  const guides = [
    { id: "guide-1", axis: "x" as const, position: 100 },
    { id: "guide-2", axis: "y" as const, position: 50 },
  ]

  test("nothing assists a free stroke", () => {
    expect(assistLine({ x: 10, y: 10, guides: [], guideReach: 8 })).toBeNull()
  })

  test("a stroke started near a vertical guide runs along it", () => {
    const chosen = assistLine({ x: 104, y: 300, guides, guideReach: 8 })!
    close(chosen.start, 100, 300)
    close(projectOntoLine(chosen.line, 140, 20), 100, 20)
  })

  test("the nearest guide within reach wins", () => {
    const chosen = assistLine({ x: 97, y: 52, guides, guideReach: 8 })!
    // 2 from the horizontal guide, 3 from the vertical one.
    close(chosen.start, 97, 50)
  })

  test("a guide out of reach is ignored", () => {
    expect(assistLine({ x: 120, y: 300, guides, guideReach: 8 })).toBeNull()
  })

  test("the straight-edge outranks a guide", () => {
    const chosen = assistLine({
      x: 101,
      y: 10,
      guides,
      guideReach: 8,
      edge: { x: 0, y: 0, angle: 0 },
    })!
    close(chosen.start, 101, 0)
  })

  test("from the last point, the line runs from where the last stroke ended", () => {
    const chosen = assistLine({
      x: 40,
      y: 40,
      guides,
      guideReach: 8,
      edge: { x: 0, y: 0, angle: 0 },
      fromLast: { x: 0, y: 0 },
    })!
    close(chosen.start, 0, 0)
    close(projectOntoLine(chosen.line, 50, 30), 40, 40)
  })

  test("from the last point onto the same spot draws nothing new", () => {
    expect(
      assistLine({
        x: 3,
        y: 3,
        guides: [],
        guideReach: 8,
        fromLast: { x: 3, y: 3 },
      })!.start
    ).toEqual({ x: 3, y: 3 })
  })
})

describe("the stroke-assist stage", () => {
  test("off, samples pass through untouched", () => {
    const assist = createStrokeAssist()
    assist.begin(null)
    close(assist.filter(12, 34), 12, 34)
  })

  test("on, every sample lands on the line", () => {
    const assist = createStrokeAssist()
    assist.begin(edgeLine({ x: 0, y: 20, angle: 0 }))
    for (const [x, y] of [
      [0, 25],
      [10, 17],
      [50, 60],
    ])
      expect(assist.filter(x, y).y).toBeCloseTo(20, 6)
  })
})
