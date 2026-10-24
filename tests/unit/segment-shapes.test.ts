import { expect, test } from "bun:test"
import {
  segmentCommand,
  selectedSegments,
  type VectorNode,
} from "../../engine/doc/node-tool"
import { editPathNode, type PathNode } from "../../engine/doc/vector-path"
import type {
  SceneCommand,
  VectorObject,
  VectorScene,
} from "../../engine/doc/vector-scene"

const at = (x: number, y: number, rest: Partial<PathNode> = {}): PathNode => ({
  x,
  y,
  in: null,
  out: null,
  type: "cusp",
  ...rest,
})

const square = (closed: boolean, nodes?: PathNode[]): VectorObject => ({
  id: "a",
  transform: [1, 0, 0, 1, 0, 0],
  style: { fill: null, stroke: null },
  geometry: {
    kind: "path",
    closed,
    nodes: nodes ?? [at(0, 0), at(30, 0), at(30, 30), at(0, 30)],
  },
})

const node = (index: number): VectorNode => ({ objectId: "a", index })
const scene = (object: VectorObject): VectorScene => ({ objects: [object] })
const nodesOf = (edits: SceneCommand[] | null) => {
  const [edit] = edits ?? []
  return edit?.type === "update" && edit.patch.geometry?.kind === "path"
    ? edit.patch.geometry.nodes
    : []
}

test("a segment is selected when both its ends are", () => {
  expect(
    selectedSegments([square(false)], [node(0), node(1), node(3)])
  ).toEqual([node(0)])
  expect(selectedSegments([square(false)], [node(0), node(2)])).toEqual([])
})

test("a closed path's last-to-first segment is one too", () => {
  expect(selectedSegments([square(true)], [node(3), node(0)])).toEqual([
    node(3),
  ])
  expect(selectedSegments([square(false)], [node(3), node(0)])).toEqual([])
})

test("make curve puts handles at a third and two thirds of the chord", () => {
  const nodes = nodesOf(
    segmentCommand(scene(square(false)), [node(0), node(1)], "curve")
  )
  expect(nodes[0].out).toEqual({ x: 10, y: 0 })
  expect(nodes[1].in).toEqual({ x: 20, y: 0 })
  expect(nodes[1].out).toBeNull()
})

test("make curve on the wrap segment of a closed path", () => {
  const nodes = nodesOf(
    segmentCommand(scene(square(true)), [node(3), node(0)], "curve")
  )
  expect(nodes[3].out).toEqual({ x: 0, y: 20 })
  expect(nodes[0].in).toEqual({ x: 0, y: 10 })
})

test("make line takes away the facing handles and nothing else", () => {
  const curved = square(true, [
    at(0, 0, { in: { x: 0, y: 5 }, out: { x: 10, y: -5 }, type: "smooth" }),
    at(30, 0, { in: { x: 20, y: -5 }, out: { x: 35, y: 10 } }),
    at(30, 30),
    at(0, 30),
  ])
  const nodes = nodesOf(
    segmentCommand(scene(curved), [node(0), node(1)], "line")
  )
  expect(nodes[0].out).toBeNull()
  expect(nodes[1].in).toBeNull()
  expect(nodes[0].in).toEqual({ x: 0, y: 5 })
  expect(nodes[1].out).toEqual({ x: 35, y: 10 })
})

test("make line turns an auto end cusp, so it stays straight", () => {
  const path = editPathNode(square(false).geometry as never, {
    type: "retype",
    index: 1,
    nodeType: "auto",
  })
  const nodes = nodesOf(
    segmentCommand(
      scene({ ...square(false), geometry: path }),
      [node(0), node(1)],
      "line"
    )
  )
  expect(nodes[1].type).toBe("cusp")
  expect(nodes[1].in).toBeNull()
})

test("nothing to do without a selected segment, or already that shape", () => {
  expect(segmentCommand(scene(square(false)), [node(0)], "line")).toBeNull()
  expect(
    segmentCommand(scene(square(false)), [node(0), node(1)], "line")
  ).toBeNull()
})
