import { expect, test } from "bun:test"
import {
  constrainHandle,
  dragNodes,
  pressNode,
  retractHandle,
  type NodeGrab,
} from "../../engine/doc/node-tool"
import type { BezierPath, PathNode } from "../../engine/doc/vector-path"
import type { VectorObject } from "../../engine/doc/vector-scene"

const anchor = { x: 0, y: 0 }

test("Ctrl snaps a handle's angle to 15° steps, keeping its reach", () => {
  const snapped = constrainHandle(
    anchor,
    { x: 10, y: 0 },
    { x: 10, y: 3 },
    {
      ctrl: true,
    }
  )
  const reach = Math.hypot(10, 3)
  expect(snapped.x).toBeCloseTo(reach * Math.cos(Math.PI / 12), 9)
  expect(snapped.y).toBeCloseTo(reach * Math.sin(Math.PI / 12), 9)
  const straight = constrainHandle(
    anchor,
    null,
    { x: -20, y: 1 },
    { ctrl: true }
  )
  expect(straight.x).toBeCloseTo(-Math.hypot(20, 1), 9)
  expect(straight.y).toBeCloseTo(0, 9)
})

test("Alt keeps a handle's length and only turns it", () => {
  const turned = constrainHandle(
    anchor,
    { x: 10, y: 0 },
    { x: 0, y: 50 },
    {
      alt: true,
    }
  )
  expect(turned.x).toBeCloseTo(0, 9)
  expect(turned.y).toBeCloseTo(10, 9)
})

test("Ctrl and Alt together snap the angle at the old length", () => {
  const both = constrainHandle(
    anchor,
    { x: 10, y: 0 },
    { x: 3, y: 40 },
    {
      ctrl: true,
      alt: true,
    }
  )
  expect(both.x).toBeCloseTo(0, 9)
  expect(both.y).toBeCloseTo(10, 9)
})

test("without modifiers a handle goes where it is put", () => {
  expect(constrainHandle(anchor, { x: 10, y: 0 }, { x: 3, y: 4 }, {})).toEqual({
    x: 3,
    y: 4,
  })
})

const node = (
  x: number,
  y: number,
  extra: Partial<PathNode> = {}
): PathNode => ({ x, y, in: null, out: null, type: "cusp", ...extra })

const object = (
  nodes: PathNode[]
): VectorObject & { geometry: BezierPath } => ({
  id: "a",
  transform: [1, 0, 0, 1, 0, 0],
  style: {
    fill: null,
    stroke: "#000000",
    strokeWidth: 1,
  } as unknown as VectorObject["style"],
  geometry: { kind: "path", closed: false, nodes },
})

const geometryOf = (edits: ReturnType<typeof dragNodes>) => {
  const [edit] = edits
  if (edit?.type !== "update") throw new Error("expected an update")
  return edit.patch.geometry as BezierPath
}

test("Shift mirrors a cusp's opposite handle for the drag", () => {
  const o = object([
    node(0, 0),
    node(50, 0, { in: { x: 40, y: 0 }, out: { x: 60, y: 10 } }),
    node(100, 0),
  ])
  const grab: NodeGrab = { object: o, index: 1, part: "out" }
  const moved = geometryOf(
    dragNodes({
      scene: { objects: [o] },
      grab,
      nodes: [],
      point: { x: 70, y: 20 },
      modifiers: { shift: true },
    })
  ).nodes[1]
  expect(moved.type).toBe("cusp")
  expect(moved.out).toEqual({ x: 70, y: 20 })
  expect(moved.in).toEqual({ x: 30, y: -20 })
  // Without Shift a cusp's other handle stays where it was.
  const free = geometryOf(
    dragNodes({
      scene: { objects: [o] },
      grab,
      nodes: [],
      point: { x: 70, y: 20 },
    })
  ).nodes[1]
  expect(free.in).toEqual({ x: 40, y: 0 })
})

test("Shift+press on a handleless anchor grabs a new handle out of it", () => {
  const o = object([node(0, 0), node(50, 0), node(100, 0)])
  const pressed = pressNode({
    scene: { objects: [o] },
    selection: ["a"],
    nodes: [],
    shift: true,
    point: { x: 50, y: 0 },
    reach: 6,
    time: 0,
  })
  expect(pressed).toMatchObject({
    kind: "grab",
    grab: { index: 1, part: "out" },
    nodes: [{ objectId: "a", index: 1 }],
  })
  if (pressed.kind !== "grab") return
  const pulled = geometryOf(
    dragNodes({
      scene: { objects: [o] },
      grab: pressed.grab,
      nodes: pressed.nodes,
      point: { x: 60, y: 20 },
    })
  ).nodes[1]
  expect(pulled).toMatchObject({ x: 50, y: 0, out: { x: 60, y: 20 } })
  // An open path's last node pulls the handle it can have.
  const last = pressNode({
    scene: { objects: [o] },
    selection: ["a"],
    nodes: [],
    shift: true,
    point: { x: 100, y: 0 },
    reach: 6,
    time: 0,
  })
  expect(last).toMatchObject({ kind: "grab", grab: { index: 2, part: "in" } })
})

test("Shift+press on an anchor with handles still toggles it", () => {
  const o = object([
    node(0, 0),
    node(50, 0, { in: { x: 40, y: 0 }, out: { x: 60, y: 0 } }),
    node(100, 0),
  ])
  expect(
    pressNode({
      scene: { objects: [o] },
      selection: ["a"],
      nodes: [],
      shift: true,
      point: { x: 50, y: 0 },
      reach: 6,
      time: 0,
    }).kind
  ).toBe("select")
})

test("retracting a handle lays it on its anchor as one update", () => {
  const o = object([
    node(0, 0),
    node(50, 0, {
      in: { x: 40, y: 0 },
      out: { x: 60, y: 0 },
      type: "auto",
    }),
    node(100, 0),
  ])
  const edits = retractHandle({ object: o, index: 1, part: "out" })
  expect(edits).toHaveLength(1)
  const n = geometryOf(edits).nodes[1]
  expect(n.out).toBeNull()
  expect(n.in).toEqual({ x: 40, y: 0 })
  // An auto node would only pull it out again: it is a cusp now.
  expect(n.type).toBe("cusp")
  expect(retractHandle({ object: o, index: 1, part: "anchor" })).toEqual([])
})
