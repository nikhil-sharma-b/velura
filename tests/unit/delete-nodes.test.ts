import { expect, test } from "bun:test"
import { deleteNodes } from "../../engine/doc/node-tool"
import {
  deletePathNodes,
  segmentPoint,
  type BezierPath,
  type PathNode,
} from "../../engine/doc/vector-path"
import type { VectorObject, VectorScene } from "../../engine/doc/vector-scene"

const at = (x: number, y: number, extra: Partial<PathNode> = {}): PathNode => ({
  x,
  y,
  in: null,
  out: null,
  type: "cusp",
  ...extra,
})

/** A half circle of radius 100 drawn through five nodes, smooth inside. */
function arc(count = 5): BezierPath {
  const k = (4 / 3) * Math.tan(Math.PI / (4 * (count - 1)))
  const nodes = Array.from({ length: count }, (_, i) => {
    const a = Math.PI - (Math.PI * i) / (count - 1)
    const p = { x: 100 * Math.cos(a), y: 100 * Math.sin(a) }
    // The tangent going on round the circle, clockwise from the left.
    const t = { x: Math.sin(a), y: -Math.cos(a) }
    return at(p.x, p.y, {
      type: i === 0 || i === count - 1 ? "cusp" : "smooth",
      in: i ? { x: p.x - t.x * 100 * k, y: p.y - t.y * 100 * k } : null,
      out:
        i < count - 1
          ? { x: p.x + t.x * 100 * k, y: p.y + t.y * 100 * k }
          : null,
    })
  })
  return { kind: "path", closed: false, nodes }
}

/** How far the path strays from the circle of radius 100 about the origin. */
const strayFromCircle = (path: BezierPath) =>
  Math.max(
    ...path.nodes.slice(0, path.closed ? undefined : -1).flatMap((_, i) =>
      Array.from({ length: 33 }, (_, s) => {
        const p = segmentPoint(path, i, s / 32)
        return Math.abs(Math.hypot(p.x, p.y) - 100)
      })
    )
  )

test("deleting the middle nodes of an arc keeps it close", () => {
  const before = arc()
  expect(strayFromCircle(before)).toBeLessThan(0.1)
  const after = deletePathNodes(before, [1, 2, 3])!
  expect(after.nodes).toHaveLength(2)
  // No one cubic draws a half circle closer than about 1.4% of its radius.
  expect(strayFromCircle(after)).toBeLessThan(1.5)
})

test("each run is fitted on its own, keeping the nodes between", () => {
  const after = deletePathNodes(arc(7), [1, 2, 4, 5])!
  expect(after.nodes).toHaveLength(3)
  expect(after.nodes[1]).toMatchObject({ x: arc(7).nodes[3].x })
  expect(strayFromCircle(after)).toBeLessThan(1)
})

test("the kept ends keep their directions", () => {
  const before = arc()
  const after = deletePathNodes(before, [1, 2, 3])!
  const direction = (from: PathNode, to: { x: number; y: number }) =>
    Math.atan2(to.y - from.y, to.x - from.x)
  expect(direction(after.nodes[0], after.nodes[0].out!)).toBeCloseTo(
    direction(before.nodes[0], before.nodes[0].out!)
  )
  expect(direction(after.nodes[1], after.nodes[1].in!)).toBeCloseTo(
    direction(before.nodes[4], before.nodes[4].in!)
  )
})

test("a run across a closed path's start is fitted as one", () => {
  // A full circle of eight nodes; delete the last, the first and the second.
  const half = arc(5).nodes
  const circle: BezierPath = {
    kind: "path",
    closed: true,
    nodes: [...half.slice(0, -1), ...half.slice(0, -1).map((n) => mirror(n))]
      .map((n) => ({ ...n, type: "smooth" as const }))
      .map((n, i, all) =>
        i === 0 || i === all.length / 2
          ? {
              ...n,
              in: n.in ?? mirror(all[i].out!, n),
              out: n.out ?? mirror(all[i].in!, n),
            }
          : n
      ),
  }
  expect(strayFromCircle(circle)).toBeLessThan(0.1)
  const after = deletePathNodes(circle, [7, 0, 1])!
  expect(after.nodes).toHaveLength(5)
  expect(after.closed).toBe(true)
  expect(strayFromCircle(after)).toBeLessThan(2)
})

/** Turned half round the origin, or reflected through `about`. */
function mirror<T extends { x: number; y: number }>(
  p: T,
  about?: { x: number; y: number }
): T {
  if (about) return { ...p, x: 2 * about.x - p.x, y: 2 * about.y - p.y }
  const turn = (q: { x: number; y: number } | null) => q && { x: -q.x, y: -q.y }
  const n = p as unknown as PathNode
  return {
    ...p,
    x: -p.x,
    y: -p.y,
    ...("in" in n ? { in: turn(n.in), out: turn(n.out) } : {}),
  }
}

test("without refitting the neighbours keep their handles", () => {
  const before = arc()
  const after = deletePathNodes(before, [2], { refit: false })!
  expect(after.nodes).toEqual([
    before.nodes[0],
    before.nodes[1],
    before.nodes[3],
    before.nodes[4],
  ])
})

test("an open path's end node goes without refitting", () => {
  const before = arc()
  const after = deletePathNodes(before, [0])!
  expect(after.nodes).toEqual(before.nodes.slice(1))
})

test("straight runs stay straight", () => {
  const line: BezierPath = {
    kind: "path",
    closed: false,
    nodes: [at(0, 0), at(50, 0), at(100, 0)],
  }
  const after = deletePathNodes(line, [1])!
  for (let s = 0; s <= 16; s++)
    expect(segmentPoint(after, 0, s / 16).y).toBeCloseTo(0, 9)
})

test("fewer than two nodes left is no path", () => {
  expect(deletePathNodes(arc(3), [0, 1])).toBeNull()
})

const object = (id: string, geometry: BezierPath): VectorObject => ({
  id,
  transform: [1, 0, 0, 1, 0, 0],
  style: {} as VectorObject["style"],
  geometry,
})
const scene = (...objects: VectorObject[]) =>
  ({ objects }) as unknown as VectorScene

test("a path left with too few nodes is removed in the same edit", () => {
  const s = scene(object("a", arc(3)), object("b", arc()))
  const result = deleteNodes(
    s,
    [
      { objectId: "a", index: 0 },
      { objectId: "a", index: 1 },
      { objectId: "b", index: 2 },
    ],
    { refit: true }
  )!
  expect(result.edits.map((e) => e.type)).toEqual(["remove", "update"])
  expect(result.nodes).toEqual([])
})

test("nothing selected is nothing to delete", () => {
  expect(deleteNodes(scene(object("a", arc())), [], { refit: true })).toBeNull()
})
