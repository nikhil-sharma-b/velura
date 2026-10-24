import { expect, test } from "bun:test"
import { dragNodes, pressNode } from "../../engine/doc/node-tool"
import {
  editPathNode,
  segmentPoint,
  type BezierPath,
  type PathNode,
} from "../../engine/doc/vector-path"
import type { VectorObject } from "../../engine/doc/vector-scene"

const corner = (x: number, y: number): PathNode => ({
  x,
  y,
  in: null,
  out: null,
  type: "cusp",
})

const line: BezierPath = {
  kind: "path",
  closed: false,
  nodes: [corner(0, 0), corner(90, 0)],
}

const at = segmentPoint

test("a bent straight segment becomes a curve through the grabbed point", () => {
  for (const t of [0.1, 0.25, 0.5, 0.7, 0.95]) {
    const point = { x: 90 * t + 7, y: 40 }
    const bent = editPathNode(line, { type: "bend", index: 0, t, point })
    expect(bent.nodes[0].out).not.toBeNull()
    expect(bent.nodes[1].in).not.toBeNull()
    const through = at(bent, 0, t)
    expect(through.x).toBeCloseTo(point.x, 6)
    expect(through.y).toBeCloseTo(point.y, 6)
  }
})

test("a grab near one end bends mostly that end's handle", () => {
  const bent = editPathNode(line, {
    type: "bend",
    index: 0,
    t: 0.1,
    point: { x: 9, y: 20 },
  })
  expect(bent.nodes[1].in).toEqual({ x: 90, y: 0 })
  expect(bent.nodes[0].out!.y).toBeGreaterThan(0)
})

test("smooth and symmetric ends keep their opposite handles in line", () => {
  const path: BezierPath = {
    kind: "path",
    closed: false,
    nodes: [
      corner(-90, 0),
      {
        x: 0,
        y: 0,
        in: { x: -30, y: 0 },
        out: { x: 30, y: 0 },
        type: "smooth",
      },
      {
        x: 90,
        y: 0,
        in: { x: 60, y: 0 },
        out: { x: 120, y: 0 },
        type: "symmetric",
      },
      corner(180, 0),
    ],
  }
  const bent = editPathNode(path, {
    type: "bend",
    index: 1,
    t: 0.5,
    point: { x: 45, y: 30 },
  })
  for (const n of [bent.nodes[1], bent.nodes[2]]) {
    const cross =
      (n.out!.x - n.x) * (n.in!.y - n.y) - (n.out!.y - n.y) * (n.in!.x - n.x)
    expect(Math.abs(cross)).toBeLessThan(1e-9)
  }
  const s = bent.nodes[2]
  expect(Math.hypot(s.in!.x - s.x, s.in!.y - s.y)).toBeCloseTo(
    Math.hypot(s.out!.x - s.x, s.out!.y - s.y),
    9
  )
  const through = at(bent, 1, 0.5)
  expect(through.x).toBeCloseTo(45, 6)
  expect(through.y).toBeCloseTo(30, 6)
})

const object: VectorObject = {
  id: "a",
  transform: [2, 0, 0, 2, 10, 0],
  style: {
    fill: null,
    stroke: "#000000",
    strokeWidth: 1,
  } as unknown as VectorObject["style"],
  geometry: line,
}

test("pressing a segment grabs it and selects its two end nodes", () => {
  const pressed = pressNode({
    scene: { objects: [object] },
    selection: [],
    nodes: [],
    shift: false,
    point: { x: 100, y: 1 },
    reach: 6,
    time: 0,
  })
  expect(pressed).toMatchObject({
    kind: "grab",
    selection: ["a"],
    nodes: [
      { objectId: "a", index: 0 },
      { objectId: "a", index: 1 },
    ],
    lastClick: { point: { x: 100, y: 1 }, time: 0 },
    grab: { part: "segment", index: 0 },
  })
  if (pressed.kind !== "grab") return
  expect(pressed.at.x).toBeCloseTo(100, 0)
  expect(pressed.at.y).toBeCloseTo(0, 6)

  const [edit] = dragNodes({
    scene: { objects: [object] },
    grab: pressed.grab,
    nodes: pressed.nodes,
    point: { x: 100, y: 50 },
  })
  expect(edit.type).toBe("update")
  if (edit.type !== "update" || pressed.grab.part !== "segment") return
  const geometry = edit.patch.geometry as BezierPath
  const through = at(geometry, 0, pressed.grab.t)
  expect(through.x).toBeCloseTo(45, 6)
  expect(through.y).toBeCloseTo(25, 6)
})

test("Shift+pressing a segment adds its end nodes to the selection", () => {
  const pressed = pressNode({
    scene: { objects: [object] },
    selection: ["a"],
    nodes: [{ objectId: "a", index: 1 }],
    shift: true,
    point: { x: 100, y: 1 },
    reach: 6,
    time: 0,
  })
  expect(pressed.nodes).toEqual([
    { objectId: "a", index: 1 },
    { objectId: "a", index: 0 },
  ])
})

test("a segment not dragged anywhere is left as it was", () => {
  const pressed = pressNode({
    scene: { objects: [object] },
    selection: [],
    nodes: [],
    shift: false,
    point: { x: 100, y: 1 },
    reach: 6,
    time: 0,
  })
  if (pressed.kind !== "grab") throw new Error("expected a grab")
  expect(
    dragNodes({
      scene: { objects: [object] },
      grab: pressed.grab,
      nodes: pressed.nodes,
      point: pressed.at,
    })
  ).toEqual([])
})
