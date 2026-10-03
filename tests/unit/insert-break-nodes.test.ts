import { expect, test } from "bun:test"
import {
  breakNodes,
  canBreak,
  insertNodes,
  type VectorNode,
} from "../../engine/doc/node-tool"
import {
  breakPath,
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

const curve: BezierPath = {
  kind: "path",
  closed: false,
  nodes: [
    at(0, 0, { out: { x: 0, y: 50 } }),
    at(100, 0, { in: { x: 100, y: 50 }, out: { x: 100, y: -50 } }),
    at(200, 0, { in: { x: 200, y: -50 } }),
  ],
}
const square: BezierPath = {
  kind: "path",
  closed: true,
  nodes: [at(0, 0), at(100, 0), at(100, 100), at(0, 100)],
}
const object = (id: string, geometry: BezierPath): VectorObject => ({
  id,
  transform: [1, 0, 0, 1, 0, 0],
  style: { fill: "#123456" } as unknown as VectorObject["style"],
  geometry,
})
const scene = (...objects: VectorObject[]) =>
  ({ objects }) as unknown as VectorScene
const node = (objectId: string, index: number): VectorNode => ({
  objectId,
  index,
})
const geometryOf = (command: unknown) =>
  (command as { patch: { geometry: BezierPath } }).patch.geometry

test("insert adds a node mid-segment keeping the shape, and selects it", () => {
  const s = scene(object("a", curve))
  const result = insertNodes(s, [node("a", 0), node("a", 1), node("a", 2)])!
  expect(result.edits).toHaveLength(1)
  const after = geometryOf(result.edits[0])
  expect(after.nodes).toHaveLength(5)
  // The originals keep their places and the new ones join them.
  expect(result.nodes.map((n) => n.index)).toEqual([0, 2, 4, 1, 3])
  // Each half retraces its part of the old segment at twice the pace.
  for (const [segment, t, half, u] of [
    [0, 0.25, 0, 0.5],
    [0, 0.75, 1, 0.5],
    [1, 0.7, 3, 0.4],
  ] as const) {
    const was = segmentPoint(curve, segment, t),
      now = segmentPoint(after, half, u)
    expect(now.x).toBeCloseTo(was.x)
    expect(now.y).toBeCloseTo(was.y)
  }
})

test("insert reaches a closed path's closing segment", () => {
  const result = insertNodes(scene(object("a", square)), [
    node("a", 3),
    node("a", 0),
  ])!
  const after = geometryOf(result.edits[0])
  expect(after.nodes.map((n) => [n.x, n.y])).toEqual([
    [0, 0],
    [100, 0],
    [100, 100],
    [0, 100],
    [0, 50],
  ])
  expect(result.nodes.map((n) => n.index).sort()).toEqual([0, 3, 4])
})

test("insert with no segment selected does nothing", () => {
  expect(insertNodes(scene(object("a", curve)), [node("a", 0)])).toBeNull()
})

test("breaking a closed path opens it at the node, ends coincident", () => {
  const [open, ...rest] = breakPath(square, [2])
  expect(rest).toEqual([])
  expect(open.closed).toBe(false)
  expect(open.nodes.map((n) => [n.x, n.y])).toEqual([
    [100, 100],
    [0, 100],
    [0, 0],
    [100, 0],
    [100, 100],
  ])
  expect(open.nodes[0].in).toBeNull()
  expect(open.nodes[4].out).toBeNull()
})

test("breaking an open path makes two, each end keeping its side's handle", () => {
  const [first, second] = breakPath(curve, [1])
  expect(first.nodes.map((n) => n.x)).toEqual([0, 100])
  expect(second.nodes.map((n) => n.x)).toEqual([100, 200])
  expect(first.nodes[1]).toMatchObject({ in: { x: 100, y: 50 }, out: null })
  expect(second.nodes[0]).toMatchObject({ in: null, out: { x: 100, y: -50 } })
})

test("an open path's end node has nothing to break", () => {
  expect(breakPath(curve, [0, 2])).toEqual([curve])
  expect(canBreak([object("a", curve)], [node("a", 0)])).toBe(false)
  expect(canBreak([object("a", curve)], [node("a", 1)])).toBe(true)
})

test("break puts the new path directly above, with the same style", () => {
  const s = scene(object("a", curve), object("b", square))
  let id = 0
  const result = breakNodes(s, [node("a", 1)], () => `new-${++id}`)!
  expect(result.edits.map((e) => e.type)).toEqual(["update", "add"])
  expect(result.edits[1]).toMatchObject({
    type: "add",
    index: 1,
    object: { id: "new-1", style: { fill: "#123456" } },
  })
  expect(result.added).toEqual(["new-1"])
})

test("break with nothing breakable does nothing", () => {
  expect(
    breakNodes(scene(object("a", curve)), [node("a", 0)], () => "x")
  ).toBeNull()
})
