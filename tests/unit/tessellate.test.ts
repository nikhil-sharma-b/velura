import { describe, expect, test } from "bun:test"

import type { VectorObject, VectorStroke } from "../../engine/doc/vector-scene"
import {
  covers,
  tessellateFill,
  tessellateObject,
} from "../../engine/geom/tessellate"

const IDENTITY = [1, 0, 0, 1, 0, 0] as const
const fill = { color: "#000000", opacity: 1, rule: "nonzero" } as const

function shape(
  geometry: VectorObject["geometry"],
  style: Partial<VectorObject["style"]> = {},
  transform: VectorObject["transform"] = IDENTITY
): VectorObject {
  return {
    id: "o",
    geometry,
    transform,
    style: { fill, stroke: null, ...style },
  }
}

const square = { kind: "rect", x: 10, y: 10, width: 20, height: 20 } as const

describe("filling", () => {
  test("a rectangle covers what is inside it and nothing outside", () => {
    const { fill } = tessellateObject(shape(square))
    for (const [x, y] of [
      [11, 11],
      [20, 20],
      [29.5, 29.5],
    ])
      expect(covers(fill!, x, y)).toBe(true)
    for (const [x, y] of [
      [9, 20],
      [31, 20],
      [20, 9],
      [20, 31],
      [0, 0],
    ])
      expect(covers(fill!, x, y)).toBe(false)
  })

  // A five-pointed star drawn in one stroke crosses itself: its middle is
  // wound twice, its points once.
  const star = Array.from({ length: 5 }, (_, i) => {
    const angle = -Math.PI / 2 + (i * 4 * Math.PI) / 5
    return { x: 50 + 40 * Math.cos(angle), y: 50 + 40 * Math.sin(angle) }
  })

  test("nonzero fills a self-crossing star's middle; evenodd leaves it empty", () => {
    const nonzero = tessellateObject(
      shape({ kind: "polygon", points: star, closed: true })
    ).fill!
    const evenodd = tessellateObject(
      shape(
        { kind: "polygon", points: star, closed: true },
        { fill: { ...fill, rule: "evenodd" } }
      )
    ).fill!
    expect(covers(nonzero, 50, 50)).toBe(true)
    expect(covers(evenodd, 50, 50)).toBe(false)
    // The top point is inside either way.
    expect(covers(nonzero, 50, 16)).toBe(true)
    expect(covers(evenodd, 50, 16)).toBe(true)
    // And outside the star is outside either way.
    expect(covers(nonzero, 50, 5)).toBe(false)
    expect(covers(evenodd, 50, 5)).toBe(false)
  })

  const box = (x: number, y: number, size: number, reversed = false) => {
    const corners = [
      { x, y },
      { x: x + size, y },
      { x: x + size, y: y + size },
      { x, y: y + size },
    ]
    return reversed ? corners.reverse() : corners
  }

  test("an inner outline wound the other way is a hole under either rule", () => {
    for (const rule of ["nonzero", "evenodd"] as const) {
      const mesh = tessellateFill([box(0, 0, 30), box(10, 10, 10, true)], rule)
      expect(covers(mesh, 5, 5)).toBe(true)
      expect(covers(mesh, 15, 15)).toBe(false)
    }
  })

  test("an inner outline wound the same way is a hole only under evenodd", () => {
    const outlines = [box(0, 0, 30), box(10, 10, 10)]
    expect(covers(tessellateFill(outlines, "nonzero"), 15, 15)).toBe(true)
    expect(covers(tessellateFill(outlines, "evenodd"), 15, 15)).toBe(false)
  })

  test("an ellipse covers its own area, to within its chords", () => {
    const { fill } = tessellateObject(
      shape({ kind: "ellipse", cx: 50, cy: 40, rx: 30, ry: 20 })
    )
    let inside = 0
    for (let y = 0; y < 100; y++)
      for (let x = 0; x < 100; x++)
        if (covers(fill!, x + 0.5, y + 0.5)) inside++
    // π·30·20 ≈ 1885 pixels.
    expect(Math.abs(inside - Math.PI * 30 * 20)).toBeLessThan(20)
    expect(covers(fill!, 79, 40)).toBe(true)
    expect(covers(fill!, 81, 40)).toBe(false)
    expect(covers(fill!, 50, 59)).toBe(true)
    expect(covers(fill!, 50, 61)).toBe(false)
  })

  test("an object is drawn where its transform puts it", () => {
    // Doubled in size about the origin, then moved right by 100.
    const { fill } = tessellateObject(shape(square, {}, [2, 0, 0, 2, 100, 0]))
    expect(fill!.bounds).toEqual({ minX: 120, minY: 20, maxX: 160, maxY: 60 })
    expect(covers(fill!, 155, 55)).toBe(true)
    expect(covers(fill!, 20, 20)).toBe(false)
  })

  test("an open polygon and an empty rectangle fill nothing", () => {
    const open = tessellateObject(
      shape({ kind: "polygon", points: star, closed: false })
    )
    expect(open.fill).toBeNull()
    const flat = tessellateObject(
      shape({ kind: "rect", x: 0, y: 0, width: 0, height: 10 })
    )
    expect(covers(flat.fill!, 0, 5)).toBe(false)
  })
})

describe("stroking", () => {
  const pen = (
    width: number,
    cap: VectorStroke["cap"] = "butt",
    join: VectorStroke["join"] = "miter"
  ): VectorStroke => ({ color: "#000000", opacity: 1, width, cap, join })

  const stroked = (
    geometry: VectorObject["geometry"],
    stroke: VectorStroke,
    transform: VectorObject["transform"] = IDENTITY
  ) => tessellateObject(shape(geometry, { fill: null, stroke }, transform))

  test("a stroke is a band centred on the outline, leaving the inside empty", () => {
    const { fill, stroke } = stroked(square, pen(4))
    expect(fill).toBeNull()
    expect(covers(stroke!, 20, 10)).toBe(true)
    expect(covers(stroke!, 20, 8.5)).toBe(true)
    expect(covers(stroke!, 20, 11.5)).toBe(true)
    expect(covers(stroke!, 20, 7.5)).toBe(false)
    expect(covers(stroke!, 20, 12.5)).toBe(false)
    expect(covers(stroke!, 20, 20)).toBe(false)
  })

  const line = {
    kind: "polygon",
    points: [
      { x: 10, y: 10 },
      { x: 30, y: 10 },
    ],
    closed: false,
  } as const

  test("a butt cap stops at the end of the line", () => {
    const { stroke } = stroked(line, pen(4, "butt"))
    expect(covers(stroke!, 11, 11.5)).toBe(true)
    expect(covers(stroke!, 9, 10)).toBe(false)
    expect(covers(stroke!, 31, 10)).toBe(false)
  })

  test("a square cap runs half the width past the end", () => {
    const { stroke } = stroked(line, pen(4, "square"))
    expect(covers(stroke!, 8.5, 11.5)).toBe(true)
    expect(covers(stroke!, 7.5, 10)).toBe(false)
    expect(covers(stroke!, 31.5, 8.5)).toBe(true)
  })

  test("a round cap ends in a half circle", () => {
    const { stroke } = stroked(line, pen(4, "round"))
    expect(covers(stroke!, 8.5, 10)).toBe(true)
    // Inside a square cap's corner, outside the circle.
    expect(covers(stroke!, 8.5, 8.5)).toBe(false)
    expect(covers(stroke!, 7.5, 10)).toBe(false)
  })

  // The square's top-left corner is (10, 10); with a width of 4 the stroke's
  // outer edges meet two pixels out from it.
  test("a miter join fills the outer corner", () => {
    const { stroke } = stroked(square, pen(4, "butt", "miter"))
    expect(covers(stroke!, 8.5, 8.5)).toBe(true)
  })

  test("a bevel join cuts the outer corner off square", () => {
    const { stroke } = stroked(square, pen(4, "butt", "bevel"))
    expect(covers(stroke!, 9.5, 9.5)).toBe(true)
    expect(covers(stroke!, 8.7, 8.7)).toBe(false)
  })

  test("a round join rounds the outer corner", () => {
    const { stroke } = stroked(square, pen(4, "butt", "round"))
    expect(covers(stroke!, 8.7, 8.7)).toBe(true)
    expect(covers(stroke!, 8.5, 8.5)).toBe(false)
  })

  test("a miter too sharp to keep falls back to a bevel", () => {
    const spike = {
      kind: "polygon",
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 5 },
        { x: 0, y: 10 },
      ],
      closed: false,
    } as const
    const { stroke } = stroked(spike, pen(4, "butt", "miter"))
    expect(covers(stroke!, 99, 5)).toBe(true)
    expect(covers(stroke!, 105, 5)).toBe(false)
  })

  const pressure = (points: { x: number; y: number; width: number }[]) =>
    ({
      kind: "path",
      nodes: points.map((p) => ({ ...p, in: null, out: null, smooth: true })),
      closed: false,
    }) as const

  test("a pressure stroke turning sharply stays within its width of the line", () => {
    const hairpin = pressure([
      { x: 0, y: 0, width: 2 },
      { x: 100, y: 5, width: 8 },
      { x: 0, y: 10, width: 2 },
    ])
    const { stroke } = stroked(hairpin, pen(4, "butt", "miter"))
    // Smooth nodes round the turn, whatever the join: no mitre spike.
    expect(covers(stroke!, 103.5, 5)).toBe(true)
    expect(covers(stroke!, 104.5, 5)).toBe(false)
    expect(covers(stroke!, 20, 5)).toBe(false)
  })

  test("a pressure stroke tapers with the pen", () => {
    const taper = pressure([
      { x: 0, y: 0, width: 2 },
      { x: 40, y: 0, width: 10 },
    ])
    const { stroke } = stroked(taper, pen(4, "butt", "miter"))
    expect(covers(stroke!, 20, 2.8)).toBe(true)
    expect(covers(stroke!, 20, 3.2)).toBe(false)
  })

  test("a stroke widens with the object's scale", () => {
    const { stroke } = stroked(square, pen(4), [2, 0, 0, 2, 0, 0])
    // The top edge is at y = 20 now, and the band four pixels either side.
    expect(covers(stroke!, 40, 16.5)).toBe(true)
    expect(covers(stroke!, 40, 15.5)).toBe(false)
  })
})
