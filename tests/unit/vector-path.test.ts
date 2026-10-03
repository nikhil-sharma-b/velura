import { describe, expect, test } from "bun:test"
import { fitPressureStroke, pickPathNode } from "../../engine/doc/vector-path"

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

test("pressure fitting keeps a sharp turn as a corner that never overshoots", async () => {
  const { flattenPath } = await import("../../engine/doc/vector-path")
  const samples = []
  for (let x = 0; x <= 100; x += 2) samples.push({ x, y: 0, pressure: 1 })
  for (let y = 2; y <= 100; y += 2) samples.push({ x: 100, y, pressure: 1 })
  const path = fitPressureStroke(samples, 4)
  const corner = path.nodes.find((n) => n.x === 100 && n.y === 0)
  expect(corner?.smooth).toBe(false)
  for (const p of flattenPath(path).points) {
    expect(p.x).toBeLessThanOrEqual(100 + 1e-9)
    expect(p.y).toBeGreaterThanOrEqual(-1e-9)
  }
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

describe("pickPathNode", () => {
  const identity = [1, 0, 0, 1, 0, 0] as const
  const corner = (x: number, y: number) => ({
    x,
    y,
    in: null,
    out: null,
    smooth: false,
  })
  const square = {
    kind: "path" as const,
    closed: true,
    nodes: [corner(0, 0), corner(100, 0), corner(100, 100), corner(0, 100)],
  }

  test("picks the anchor under the point", () => {
    expect(pickPathNode(square, { x: 101, y: 2 }, identity, 6)).toMatchObject({
      index: 1,
      part: "anchor",
      at: { x: 100, y: 0 },
    })
  })

  test("is null away from every node", () => {
    expect(pickPathNode(square, { x: 50, y: 50 }, identity, 6)).toBeNull()
  })

  test("a handle sitting on its anchor never wins over the anchor", () => {
    // A pen click without a drag can leave zero-length handles behind.
    const path = {
      ...square,
      nodes: square.nodes.map((node) => ({
        ...node,
        in: { x: node.x, y: node.y },
        out: { x: node.x + 2, y: node.y },
      })),
    }
    expect(pickPathNode(path, { x: 102, y: 0 }, identity, 6)).toMatchObject({
      index: 1,
      part: "anchor",
    })
  })

  test("a handle pulled clear of its anchor is picked", () => {
    const path = {
      ...square,
      nodes: [
        { ...square.nodes[0], out: { x: 30, y: -20 } },
        ...square.nodes.slice(1),
      ],
    }
    expect(pickPathNode(path, { x: 31, y: -19 }, identity, 6)).toMatchObject({
      index: 0,
      part: "out",
      at: { x: 30, y: -20 },
    })
  })

  test("the nearer of an anchor and a pulled-out handle wins", () => {
    const path = {
      ...square,
      nodes: [
        { ...square.nodes[0], out: { x: 8, y: 0 } },
        ...square.nodes.slice(1),
      ],
    }
    expect(pickPathNode(path, { x: 1, y: 0 }, identity, 6)?.part).toBe("anchor")
    expect(pickPathNode(path, { x: 9, y: 0 }, identity, 6)?.part).toBe("out")
  })

  test("handles can be left out, as for a path not yet selected", () => {
    const path = {
      ...square,
      nodes: [
        { ...square.nodes[0], out: { x: 30, y: -20 } },
        ...square.nodes.slice(1),
      ],
    }
    expect(
      pickPathNode(path, { x: 30, y: -20 }, identity, 6, { handles: false })
    ).toBeNull()
  })

  test("measures in document space, through the object's transform", () => {
    const moved = [2, 0, 0, 2, 10, 10] as const
    expect(pickPathNode(square, { x: 210, y: 12 }, moved, 6)).toMatchObject({
      index: 1,
      part: "anchor",
    })
  })
})
