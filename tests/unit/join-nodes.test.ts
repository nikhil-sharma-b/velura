import { expect, test } from "bun:test"
import {
  canJoin,
  deleteSegments,
  joinNodes,
  type VectorNode,
} from "../../engine/doc/node-tool"
import {
  cutPathSegments,
  joinPathEnds,
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
const open = (...nodes: PathNode[]): BezierPath => ({
  kind: "path",
  closed: false,
  nodes,
})
const square: BezierPath = {
  kind: "path",
  closed: true,
  nodes: [at(0, 0), at(100, 0), at(100, 100), at(0, 100)],
}
const object = (
  id: string,
  geometry: BezierPath,
  dx = 0,
  fill = "#111111"
): VectorObject => ({
  id,
  transform: [1, 0, 0, 1, dx, 0],
  style: { fill } as unknown as VectorObject["style"],
  geometry,
})
const scene = (...objects: VectorObject[]) =>
  ({ objects }) as unknown as VectorScene
const node = (objectId: string, index: number): VectorNode => ({
  objectId,
  index,
})
const xy = (path: BezierPath) => path.nodes.map((n) => [n.x, n.y])
const geometryOf = (command: unknown) =>
  (command as { patch: { geometry: BezierPath } }).patch.geometry

const hook = open(
  at(0, 0),
  at(100, 0, { out: { x: 120, y: 20 } }),
  at(100, 100, { in: { x: 90, y: 110 } })
)

test("joining a path's own ends merges them at the midpoint and closes it", () => {
  const joined = joinPathEnds(hook, "start", null, "end", "merge")
  expect(joined.closed).toBe(true)
  expect(xy(joined)).toEqual([
    [50, 50],
    [100, 0],
  ])
  // The merged node keeps both ends' handles, moved with their anchors.
  expect(joined.nodes[0].in).toEqual({ x: 40, y: 60 })
})

test("joining a path's own ends with a segment closes it straight", () => {
  const joined = joinPathEnds(hook, "end", null, "start", "segment")
  expect(joined).toEqual({ ...hook, closed: true })
  // A stray handle off either end would bend the closing segment.
  const stray = joinPathEnds(
    open(
      at(0, 0, { in: { x: 5, y: 5 } }),
      at(9, 0),
      at(9, 9, { out: { x: 1, y: 1 } })
    ),
    "start",
    null,
    "end",
    "segment"
  )
  expect(stray.nodes[0].in).toBeNull()
  expect(stray.nodes[2].out).toBeNull()
})

test("two paths merge end to start, the second turned round to fit", () => {
  const a = open(at(0, 0), at(10, 0))
  const b = open(at(30, 0), at(20, 0, { in: { x: 25, y: 5 } }))
  const merged = joinPathEnds(a, "end", b, "end", "merge")
  expect(xy(merged)).toEqual([
    [0, 0],
    [15, 0],
    [30, 0],
  ])
  // Turned round, b's in-handle at its end leads out of the joined node.
  expect(merged.nodes[1].out).toEqual({ x: 20, y: 5 })
  const linked = joinPathEnds(a, "start", b, "start", "segment")
  expect(xy(linked)).toEqual([
    [10, 0],
    [0, 0],
    [30, 0],
    [20, 0],
  ])
  expect(linked.closed).toBe(false)
})

test("join needs exactly two open-path ends", () => {
  const paths = [object("a", hook), object("b", square)]
  expect(canJoin(paths, [node("a", 0), node("a", 2)])).toBe(true)
  expect(canJoin(paths, [node("a", 0), node("a", 1)])).toBe(false)
  expect(canJoin(paths, [node("a", 0)])).toBe(false)
  expect(canJoin(paths, [node("a", 0), node("b", 0)])).toBe(false)
  // A two-node path's ends merged would leave one node.
  const short = [object("c", open(at(0, 0), at(5, 0)))]
  expect(canJoin(short, [node("c", 0), node("c", 1)], "merge")).toBe(false)
  expect(canJoin(short, [node("c", 0), node("c", 1)], "segment")).toBe(true)
})

test("two objects join as one with the first one's style, in its space", () => {
  const s = scene(
    object("a", open(at(0, 0), at(10, 0))),
    object("b", open(at(0, 0), at(10, 0)), 100, "#222222")
  )
  const result = joinNodes(s, [node("b", 0), node("a", 1)], "segment")!
  expect(result.edits.map((e) => e.type)).toEqual(["update", "remove"])
  expect(result.edits[0]).toMatchObject({ id: "b" })
  expect(result.edits[1]).toMatchObject({ id: "a" })
  // b runs on into a, whose nodes sit 100 left of b's origin.
  expect(xy(geometryOf(result.edits[0]))).toEqual([
    [10, 0],
    [0, 0],
    [-90, 0],
    [-100, 0],
  ])
  expect(result.removed).toEqual(["a"])
  expect(result.nodes).toEqual([node("b", 1), node("b", 2)])
  const merged = joinNodes(s, [node("b", 0), node("a", 1)], "merge")!
  expect(merged.nodes).toEqual([node("b", 1)])
})

test("join does nothing when the selection doesn't fit", () => {
  expect(
    joinNodes(scene(object("a", hook)), [node("a", 1)], "merge")
  ).toBeNull()
})

test("cutting a closed path's segment opens it there", () => {
  const [opened, ...rest] = cutPathSegments(square, [1])
  expect(rest).toEqual([])
  expect(opened.closed).toBe(false)
  expect(xy(opened)).toEqual([
    [100, 100],
    [0, 100],
    [0, 0],
    [100, 0],
  ])
})

test("cutting an open path's segment splits it; a lone node goes", () => {
  const line = open(at(0, 0), at(10, 0), at(20, 0), at(30, 0))
  expect(cutPathSegments(line, [1]).map(xy)).toEqual([
    [
      [0, 0],
      [10, 0],
    ],
    [
      [20, 0],
      [30, 0],
    ],
  ])
  expect(cutPathSegments(line, [0]).map(xy)).toEqual([
    [
      [10, 0],
      [20, 0],
      [30, 0],
    ],
  ])
  expect(cutPathSegments(open(at(0, 0), at(1, 0)), [0])).toEqual([])
})

test("deleting a segment adds the far piece above; nothing left removes it", () => {
  const line = open(at(0, 0), at(10, 0), at(20, 0), at(30, 0))
  const s = scene(object("a", line), object("b", open(at(0, 0), at(1, 0))))
  let id = 0
  const result = deleteSegments(
    s,
    [node("a", 1), node("a", 2), node("b", 0), node("b", 1)],
    () => `new-${++id}`
  )!
  expect(result.edits.map((e) => e.type)).toEqual(["remove", "update", "add"])
  expect(result.edits[2]).toMatchObject({ index: 1, object: { id: "new-1" } })
  expect(result.added).toEqual(["new-1"])
  expect(result.removed).toEqual(["b"])
})
