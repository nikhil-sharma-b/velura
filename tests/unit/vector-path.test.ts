import { describe, expect, test } from "bun:test"
import {
  createPressureFit,
  fitPressureStroke,
  flattenPath,
  pickPathNode,
  type BezierPath,
  type Taper,
} from "../../engine/doc/vector-path"

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
  expect(corner?.type).toBe("cusp")
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
      {
        x: 0,
        y: 0,
        in: null,
        out: { x: 0, y: 20 },
        type: "cusp" as const,
        width: 2,
      },
      {
        x: 20,
        y: 0,
        in: { x: 20, y: 20 },
        out: null,
        type: "cusp" as const,
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
  const corner = editPathNode(handled, {
    type: "retype",
    index: 1,
    nodeType: "cusp",
  })
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
        { x: 10, y: 20, width: 4, in: null, out: null, type: "cusp" as const },
        { x: 30, y: 20, width: 12, in: null, out: null, type: "cusp" as const },
        { x: 30, y: 40, width: 12, in: null, out: null, type: "cusp" as const },
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
    type: "cusp" as const,
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

test("fitting a wobbly hand-drawn line with noisy pressure keeps it to a few nodes", () => {
  // The line from the bug report: 500 px, drifting 15 px, half-pixel jitter,
  // pressure wandering a few percent.
  const samples = Array.from({ length: 250 }, (_, i) => ({
    x: i * 2,
    y: i * 0.06 + Math.sin(i * 1.7) * 0.5,
    pressure: 0.6 + Math.sin(i * 2.3) * 0.03,
  }))
  const path = fitPressureStroke(samples, 4)
  expect(path.nodes.length).toBeLessThanOrEqual(3)
  expect(path.nodes[0]).toMatchObject({ x: 0, y: 0 })
  expect(path.nodes.at(-1)).toMatchObject({ x: 498 })
})

test("fitting a smooth arc uses few nodes and stays within a pixel and a half", async () => {
  const { flattenPath } = await import("../../engine/doc/vector-path")
  const samples = Array.from({ length: 200 }, (_, i) => {
    const angle = (i / 199) * Math.PI
    return {
      x: 100 - Math.cos(angle) * 100,
      y: Math.sin(angle) * 100,
      pressure: 1,
    }
  })
  const path = fitPressureStroke(samples, 4)
  expect(path.nodes.length).toBeLessThanOrEqual(4)
  expect(path.nodes.every((n) => n.type === "smooth")).toBe(true)
  for (const p of flattenPath(path).points)
    expect(Math.abs(Math.hypot(p.x - 100, p.y) - 100)).toBeLessThanOrEqual(1.5)
})

test("fitting keeps a node where pressure departs from a straight run", () => {
  const samples = Array.from({ length: 101 }, (_, x) => ({
    x,
    y: 0,
    pressure: x < 50 ? 0.2 : 1,
  }))
  const path = fitPressureStroke(samples, 10)
  expect(path.nodes.length).toBeGreaterThan(2)
  expect(path.nodes.length).toBeLessThanOrEqual(5)
})

describe("pressure stroke hooks", () => {
  test("a hook flicked as the pen lands is not kept as a corner", () => {
    const samples = [
      { x: 3, y: 3, pressure: 0.3 },
      { x: 1.5, y: 1.5, pressure: 0.4 },
    ]
    for (let i = 0; i <= 100; i++)
      samples.push({ x: i * 2, y: 40 * Math.sin(i / 30), pressure: 0.6 })
    const { nodes } = fitPressureStroke(samples, 4)
    expect(nodes[0]).toMatchObject({ x: 0, y: 0 })
    expect(nodes.every((n) => n.type !== "cusp")).toBe(true)
  })

  test("a corner well inside the stroke stays sharp", () => {
    const samples = []
    for (let i = 0; i <= 30; i++) samples.push({ x: i * 2, y: 0, pressure: 1 })
    for (let i = 1; i <= 30; i++) samples.push({ x: 60, y: i * 2, pressure: 1 })
    const { nodes } = fitPressureStroke(samples, 4)
    expect(nodes.some((n) => n.type === "cusp")).toBe(true)
  })
})

describe("pressure stroke ends", () => {
  test("the pen landing and lifting does not taper the ends", () => {
    const samples = []
    for (let i = 0; i <= 100; i++)
      samples.push({
        x: i * 2,
        y: 0,
        // Ramps in over the first 6% and out over the last 6%.
        pressure: Math.min(1, i / 6, (100 - i) / 6),
      })
    const { nodes } = fitPressureStroke(samples, 10)
    expect(nodes[0].width).toBeCloseTo(10, 5)
    expect(nodes.at(-1)!.width).toBeCloseTo(10, 5)
  })
})

describe("tapered strokes", () => {
  const line = () => {
    const samples = []
    for (let i = 0; i <= 100; i++) samples.push({ x: i * 2, y: 0, pressure: 1 })
    return samples
  }

  test("a start taper narrows the first share of the stroke to a point", () => {
    const { nodes } = fitPressureStroke(line(), 10, { start: 0.25, end: 0 })
    expect(nodes[0].width).toBeCloseTo(0, 5)
    expect(nodes.at(-1)!.width).toBeCloseTo(10, 5)
    // Full width again by a quarter of the way along.
    const past = nodes.filter((n) => n.x >= 50)
    expect(past.every((n) => n.width! > 9.9)).toBe(true)
  })

  test("both ends taper, each by its own share, with a node apiece", () => {
    const path = fitPressureStroke(line(), 10, { start: 0.1, end: 0.5 })
    const { nodes } = path
    expect(nodes[0].width).toBeCloseTo(0, 5)
    expect(nodes.at(-1)!.width).toBeCloseTo(0, 5)
    // A straight line: its two tips, and where each taper meets full width.
    expect(nodes.map((n) => Math.round(n.x))).toEqual([0, 20, 100, 200])
    // Drawn, the end's width eases down from x = 100, never past full.
    const { points, widths } = flattenPath(path, 4)
    const end = points
      .map((p, i) => ({ x: p.x, w: widths![i] }))
      .filter((p) => p.x >= 100)
    for (let i = 1; i < end.length; i++)
      expect(end[i].w).toBeLessThanOrEqual(end[i - 1].w + 1e-9)
    expect(Math.max(...widths!)).toBeLessThanOrEqual(10 + 1e-9)
  })

  test("no taper leaves the width whole", () => {
    const { nodes } = fitPressureStroke(line(), 10, { start: 0, end: 0 })
    expect(nodes.every((n) => n.width === 10)).toBe(true)
  })
})

describe("a pressure stroke fitted as it is drawn", () => {
  const sample = (i: number) => ({
    x: i * 2,
    y: 30 * Math.sin(i / 20),
    pressure: 0.5 + 0.4 * Math.sin(i / 13),
  })
  const draw = (count: number, perFrame: number, taper?: Taper) => {
    const fit = createPressureFit(8, taper)
    const frames: BezierPath[] = []
    for (let i = 0; i < count; i += perFrame) {
      fit.add(
        Array.from({ length: Math.min(perFrame, count - i) }, (_, k) =>
          sample(i + k)
        )
      )
      frames.push(fit.path(false))
    }
    return { frames, lifted: fit.path(true) }
  }

  test("lifting the pen fits the stroke within the tolerance of what was drawn", () => {
    for (const taper of [undefined, { start: 0.2, end: 0.3 }]) {
      const { frames, lifted } = draw(400, 4, taper)
      expect(lifted.nodes.length).toBeLessThan(frames.at(-1)!.nodes.length / 4)
      const drawn = frames.at(-1)!.nodes
      for (const node of lifted.nodes) {
        const near = Math.min(
          ...drawn.map((n) => Math.hypot(n.x - node.x, n.y - node.y))
        )
        expect(near).toBeLessThan(2)
      }
    }
  })

  test("the stroke drawn so far never moves while the pen is down", () => {
    const { frames } = draw(400, 1)
    // From the second sample on: the first is a dot, its node doubled.
    for (let f = 2; f < frames.length; f++) {
      const before = frames[f - 1].nodes,
        after = frames[f].nodes
      before.forEach((n, i) => {
        expect(after[i].x).toBe(n.x)
        expect(after[i].y).toBe(n.y)
      })
    }
  })
})

test("the pen landing and lifting adds no nodes at the ends", () => {
  const samples = []
  for (let i = 0; i <= 100; i++)
    samples.push({
      x: i * 2,
      y: 0,
      pressure: Math.min(1, i / 6, (100 - i) / 6),
    })
  expect(fitPressureStroke(samples, 10).nodes).toHaveLength(2)
})
