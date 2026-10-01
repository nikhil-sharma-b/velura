import { expect, test } from "bun:test"
import { fitPressureStroke } from "../../engine/doc/vector-path"

test("pressure fitting retains the centre line endpoints and pressure extrema", () => {
  const path = fitPressureStroke(
    [
      { x: 0, y: 0, pressure: 0.2 },
      { x: 10, y: 0, pressure: 1 },
      { x: 20, y: 0, pressure: 0.2 },
    ],
    10
  )
  expect(path.kind).toBe("path")
  expect(path.closed).toBe(false)
  expect(path.nodes.map((n) => [n.x, n.y, n.width])).toEqual([
    [0, 0, 2],
    [10, 0, 10],
    [20, 0, 2],
  ])
})

test("splitting a curved pressure path preserves its centre line and interpolates width", async () => {
  const { flattenPath, splitPathSegment } =
    await import("../../engine/doc/vector-path")
  const path = {
    kind: "path" as const,
    closed: false,
    nodes: [
      { x: 0, y: 0, in: null, out: { x: 0, y: 20 }, smooth: false, width: 2 },
      {
        x: 20,
        y: 0,
        in: { x: 20, y: 20 },
        out: null,
        smooth: false,
        width: 10,
      },
    ],
  }
  const split = splitPathSegment(path, 0)
  expect(split.nodes[1]).toMatchObject({ x: 10, y: 15, width: 6 })
  expect(flattenPath(split)).toEqual(flattenPath(path))
})

test("moving anchors carries handles; smooth handles stay aligned and corner handles move independently", async () => {
  const { editPathNode } = await import("../../engine/doc/vector-path")
  const path = fitPressureStroke(
    [
      { x: 0, y: 0, pressure: 1 },
      { x: 6, y: 0, pressure: 0.5 },
      { x: 12, y: 0, pressure: 1 },
    ],
    4
  )
  const moved = editPathNode(path, {
    type: "move",
    index: 1,
    part: "anchor",
    point: { x: 6, y: 5 },
  })
  expect(moved.nodes[1].in).toEqual({ x: 4, y: 5 })
  const handled = editPathNode(moved, {
    type: "move",
    index: 1,
    part: "out",
    point: { x: 6, y: 9 },
  })
  expect(handled.nodes[1].in).toEqual({ x: 6, y: 3 })
  const corner = editPathNode(handled, { type: "toggle", index: 1 })
  expect(
    editPathNode(corner, {
      type: "move",
      index: 1,
      part: "out",
      point: { x: 9, y: 8 },
    }).nodes[1].in
  ).toEqual({ x: 6, y: 3 })
  expect(editPathNode(path, { type: "delete", index: 1 }).nodes).toHaveLength(2)
  expect(() =>
    editPathNode(
      { ...path, nodes: path.nodes.slice(0, 2) },
      { type: "delete", index: 0 }
    )
  ).toThrow()
})

test("fitting reduces straight constant-width samples to editable endpoints", () => {
  const path = fitPressureStroke(
    Array.from({ length: 101 }, (_, x) => ({ x, y: 5, pressure: 0.5 })),
    10
  )
  expect(path.nodes).toHaveLength(2)
  expect(path.nodes[0]).toMatchObject({ x: 0, y: 5, width: 5 })
  expect(path.nodes[1]).toMatchObject({ x: 100, y: 5, width: 5 })
})

test("pressure outlines taper and honor butt, square, round caps and corner joins", async () => {
  const { covers, tessellateObject } =
    await import("../../engine/geom/tessellate")
  const object = {
    id: "pressure",
    transform: [1, 0, 0, 1, 0, 0] as const,
    geometry: {
      kind: "path" as const,
      closed: false,
      nodes: [
        { x: 10, y: 20, width: 4, in: null, out: null, smooth: false },
        { x: 30, y: 20, width: 12, in: null, out: null, smooth: false },
        { x: 30, y: 40, width: 12, in: null, out: null, smooth: false },
      ],
    },
    style: {
      fill: null,
      stroke: {
        color: "#000000",
        opacity: 1,
        width: 12,
        cap: "butt" as const,
        join: "bevel" as const,
      },
    },
  }
  const butt = tessellateObject(object).stroke!
  expect(covers(butt, 9, 20)).toBe(false)
  expect(covers(butt, 11, 21)).toBe(true)
  expect(covers(butt, 11, 23)).toBe(false)
  expect(covers(butt, 35, 15)).toBe(false)
  const square = tessellateObject({
    ...object,
    style: { fill: null, stroke: { ...object.style.stroke, cap: "square" } },
  }).stroke!
  expect(covers(square, 9, 20)).toBe(true)
  const round = tessellateObject({
    ...object,
    style: { fill: null, stroke: { ...object.style.stroke, cap: "round" } },
  }).stroke!
  expect(covers(round, 9, 20)).toBe(true)
  const miter = tessellateObject({
    ...object,
    style: { fill: null, stroke: { ...object.style.stroke, join: "miter" } },
  }).stroke!
  expect(covers(miter, 35, 15)).toBe(true)
})
