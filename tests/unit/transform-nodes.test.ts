import { expect, test } from "bun:test"
import { transformNodes, type VectorNode } from "../../engine/doc/node-tool"
import type { BezierPath, PathNode } from "../../engine/doc/vector-path"
import type {
  SceneCommand,
  VectorObject,
  VectorScene,
} from "../../engine/doc/vector-scene"

const at = (x: number, y: number, extra: Partial<PathNode> = {}): PathNode => ({
  x,
  y,
  in: null,
  out: null,
  type: "cusp",
  ...extra,
})
const square: BezierPath = {
  kind: "path",
  closed: true,
  nodes: [
    at(0, 0, { out: { x: 10, y: 0 } }),
    at(100, 0),
    at(100, 100),
    at(0, 100),
  ],
}
const object = (
  geometry: BezierPath,
  transform: VectorObject["transform"] = [1, 0, 0, 1, 0, 0]
): VectorObject => ({
  id: "a",
  transform,
  style: {} as VectorObject["style"],
  geometry,
})
const scene = (o: VectorObject) => ({ objects: [o] }) as unknown as VectorScene
const node = (index: number): VectorNode => ({ objectId: "a", index })
const nodesOf = (edits: SceneCommand[]) =>
  (edits[0] as { patch: { geometry: BezierPath } }).patch.geometry.nodes
const round = (n: number) => Math.round(n * 1e6) / 1e6 + 0
const xy = (nodes: readonly PathNode[]) =>
  nodes.map((n) => [round(n.x), round(n.y)])

const all = [0, 1, 2, 3].map(node)

test("scaling grows the selection's bounds by the step each side", () => {
  // Half of 100 is 50; 2 more makes 52, a factor of 1.04 about (50, 50).
  const nodes = nodesOf(
    transformNodes(scene(object(square)), all, { kind: "scale", by: 2 })
  )
  expect(xy(nodes)).toEqual([
    [-2, -2],
    [102, -2],
    [102, 102],
    [-2, 102],
  ])
  // Handles go with their anchors.
  expect(round(nodes[0].out!.x)).toBe(round(-2 + 10 * 1.04))
})

test("rotating turns the selection about its centre, clockwise on screen", () => {
  const nodes = nodesOf(
    transformNodes(scene(object(square)), all, {
      kind: "rotate",
      angle: Math.PI / 2,
    })
  )
  expect(xy(nodes)).toEqual([
    [100, 0],
    [100, 100],
    [0, 100],
    [0, 0],
  ])
  expect(xy([{ ...nodes[0], ...nodes[0].out! }])).toEqual([[100, 10]])
})

test("a rotation by arc turns the farthest node that far along", () => {
  const radius = Math.hypot(50, 50)
  const nodes = nodesOf(
    transformNodes(scene(object(square)), all, { kind: "rotate", arc: 1 })
  )
  const turned = Math.atan2(nodes[1].y - 50, nodes[1].x - 50)
  expect(turned - Math.atan2(-50, 50)).toBeCloseTo(1 / radius)
})

test("flips mirror about the centre", () => {
  const two = [node(0), node(1)]
  const h = nodesOf(
    transformNodes(scene(object(square)), two, {
      kind: "flip",
      axis: "horizontal",
    })
  )
  expect(xy(h.slice(0, 2))).toEqual([
    [100, 0],
    [0, 0],
  ])
  expect(round(h[0].out!.x)).toBe(90)
  const v = nodesOf(
    transformNodes(scene(object(square)), [node(0), node(3)], {
      kind: "flip",
      axis: "vertical",
    })
  )
  expect(xy([v[0], v[3]])).toEqual([
    [0, 100],
    [0, 0],
  ])
})

test("transforms happen on the canvas, whatever the object's transform", () => {
  // Scaled 2x: a 2 px document step is 1 px of the path's own.
  const nodes = nodesOf(
    transformNodes(scene(object(square, [2, 0, 0, 2, 0, 0])), all, {
      kind: "scale",
      by: 2,
    })
  )
  expect(xy([nodes[0]])).toEqual([[-1, -1]])
})

test("one node's handles scale and turn about its anchor", () => {
  const corner: BezierPath = {
    kind: "path",
    closed: false,
    nodes: [
      at(0, 0),
      at(50, 0, { in: { x: 40, y: 0 }, out: { x: 50, y: 20 } }),
      at(100, 0),
    ],
  }
  const scaled = nodesOf(
    transformNodes(scene(object(corner)), [node(1)], { kind: "scale", by: 2 })
  )[1]
  expect(xy([scaled])).toEqual([[50, 0]])
  expect(scaled.in).toEqual({ x: 38, y: 0 })
  expect(scaled.out).toEqual({ x: 50, y: 22 })
  const turned = nodesOf(
    transformNodes(scene(object(corner)), [node(1)], {
      kind: "rotate",
      angle: Math.PI / 2,
    })
  )[1]
  expect(xy([turned, { ...turned, ...turned.in! }])).toEqual([
    [50, 0],
    [50, -10],
  ])
})

test("one auto node's handles, once turned, are its own: it goes smooth", () => {
  const curve: BezierPath = {
    kind: "path",
    closed: false,
    nodes: [
      at(0, 0),
      at(50, 0, { type: "auto", in: { x: 40, y: 0 }, out: { x: 60, y: 0 } }),
      at(100, 0),
    ],
  }
  const n = nodesOf(
    transformNodes(scene(object(curve)), [node(1)], {
      kind: "rotate",
      angle: Math.PI / 2,
    })
  )[1]
  expect(n.type).toBe("smooth")
  expect(xy([{ ...n, ...n.out! }])).toEqual([[50, 10]])
})

test("a shrink never turns a handle inside out", () => {
  const corner: BezierPath = {
    kind: "path",
    closed: false,
    nodes: [at(0, 0), at(50, 0, { in: { x: 49, y: 0 } }), at(100, 0)],
  }
  const n = nodesOf(
    transformNodes(scene(object(corner)), [node(1)], { kind: "scale", by: -2 })
  )[1]
  expect(n.in).toEqual({ x: 50, y: 0 })
})

test("nothing selected, or nothing to scale, does nothing", () => {
  expect(
    transformNodes(scene(object(square)), [], { kind: "scale", by: 2 })
  ).toEqual([])
  expect(
    transformNodes(scene(object(square)), [node(1)], { kind: "scale", by: 2 })
  ).toEqual([])
})
