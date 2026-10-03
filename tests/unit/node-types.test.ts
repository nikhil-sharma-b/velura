import { describe, expect, test } from "bun:test"
import {
  editPathNode,
  nextNodeType,
  type BezierPath,
  type NodeType,
  type PathNode,
} from "../../engine/doc/vector-path"
import { parseScene } from "../../engine/doc/vector-scene"

const at = (x: number, y: number, type: NodeType = "cusp"): PathNode => ({
  x,
  y,
  in: null,
  out: null,
  type,
})

/** A zig-zag whose middle node is the one under test. */
const zig = (middle: PathNode): BezierPath => ({
  kind: "path",
  closed: false,
  nodes: [at(0, 0), middle, at(60, 0)],
})

const handled = (type: NodeType): PathNode => ({
  x: 30,
  y: 30,
  in: { x: 20, y: 30 },
  out: { x: 50, y: 30 },
  type,
})

const dragOut = (path: BezierPath, point = { x: 30, y: 50 }) =>
  editPathNode(path, { type: "move", index: 1, part: "out", point }).nodes[1]

describe("dragging a handle", () => {
  test("a cusp's handles move independently", () => {
    const node = dragOut(zig(handled("cusp")))
    expect(node.out).toEqual({ x: 30, y: 50 })
    expect(node.in).toEqual({ x: 20, y: 30 })
    expect(node.type).toBe("cusp")
  })

  test("a smooth node keeps its handles in line, each its own length", () => {
    const node = dragOut(zig(handled("smooth")))
    expect(node.out).toEqual({ x: 30, y: 50 })
    expect(node.in!.x).toBeCloseTo(30)
    expect(node.in!.y).toBeCloseTo(20)
    expect(node.type).toBe("smooth")
  })

  test("a symmetric node mirrors the dragged handle", () => {
    const node = dragOut(zig(handled("symmetric")))
    expect(node.in!.x).toBeCloseTo(30)
    expect(node.in!.y).toBeCloseTo(10)
    expect(node.type).toBe("symmetric")
  })

  test("an auto node's handle, once dragged, makes it smooth", () => {
    const path = editPathNode(zig(at(30, 30, "auto")), {
      type: "retype",
      index: 1,
      nodeType: "auto",
    })
    const node = dragOut(path)
    expect(node.type).toBe("smooth")
    expect(node.out).toEqual({ x: 30, y: 50 })
    expect(node.in!.x).toBeCloseTo(30)
  })
})

describe("auto-smooth", () => {
  test("handles lie along the neighbour chord, a third of each chord", () => {
    const path = editPathNode(zig(at(30, 30)), {
      type: "retype",
      index: 1,
      nodeType: "auto",
    })
    const node = path.nodes[1]
    // Neighbours (0,0) and (60,0): the chord is horizontal; each side is
    // hypot(30, 30) long, a third of which is 10√2.
    const third = Math.hypot(30, 30) / 3
    expect(node.in!.x).toBeCloseTo(30 - third)
    expect(node.in!.y).toBeCloseTo(30)
    expect(node.out!.x).toBeCloseTo(30 + third)
    expect(node.out!.y).toBeCloseTo(30)
  })

  test("re-solves when a neighbour moves", () => {
    const path = editPathNode(zig(at(30, 30)), {
      type: "retype",
      index: 1,
      nodeType: "auto",
    })
    const moved = editPathNode(path, {
      type: "move",
      index: 2,
      part: "anchor",
      point: { x: 60, y: 60 },
    })
    const node = moved.nodes[1]
    // Chord from (0,0) to (60,60): the handles now run diagonally.
    expect(node.out!.x - node.x).toBeCloseTo(node.out!.y - node.y)
    expect(node.out!.x).toBeGreaterThan(30)
  })
})

describe("converting", () => {
  test("a handleless cusp pulls handles out along the neighbour chord", () => {
    for (const nodeType of ["smooth", "symmetric"] as const) {
      const node = editPathNode(zig(at(30, 30)), {
        type: "retype",
        index: 1,
        nodeType,
      }).nodes[1]
      expect(node.type).toBe(nodeType)
      expect(node.in!.y).toBeCloseTo(30)
      expect(node.out!.y).toBeCloseTo(30)
      expect(node.in!.x).toBeLessThan(30)
      expect(node.out!.x).toBeGreaterThan(30)
    }
  })

  test("to smooth lines up a cusp's handles, keeping their lengths", () => {
    const cusp: PathNode = {
      ...at(30, 30),
      in: { x: 20, y: 30 },
      out: { x: 30, y: 50 },
    }
    const node = editPathNode(zig(cusp), {
      type: "retype",
      index: 1,
      nodeType: "smooth",
    }).nodes[1]
    const din = { x: node.in!.x - 30, y: node.in!.y - 30 },
      dout = { x: node.out!.x - 30, y: node.out!.y - 30 }
    expect(din.x * dout.y - din.y * dout.x).toBeCloseTo(0)
    expect(Math.hypot(din.x, din.y)).toBeCloseTo(10)
    expect(Math.hypot(dout.x, dout.y)).toBeCloseTo(20)
  })

  test("to symmetric evens the lengths", () => {
    const node = editPathNode(zig(handled("smooth")), {
      type: "retype",
      index: 1,
      nodeType: "symmetric",
    }).nodes[1]
    expect(node.in).toEqual({ x: 15, y: 30 })
    expect(node.out).toEqual({ x: 45, y: 30 })
  })

  test("to cusp leaves the handles where they are", () => {
    const node = editPathNode(zig(handled("smooth")), {
      type: "retype",
      index: 1,
      nodeType: "cusp",
    }).nodes[1]
    expect(node).toEqual(handled("cusp"))
  })

  test("Ctrl+click cycles cusp, smooth, symmetric, auto and round", () => {
    expect(nextNodeType("cusp")).toBe("smooth")
    expect(nextNodeType("smooth")).toBe("symmetric")
    expect(nextNodeType("symmetric")).toBe("auto")
    expect(nextNodeType("auto")).toBe("cusp")
  })
})

describe("saved documents", () => {
  const saved = (nodes: unknown[]) => ({
    objects: [
      {
        id: "a",
        transform: [1, 0, 0, 1, 0, 0],
        style: { fill: null, stroke: null },
        geometry: { kind: "path", closed: false, nodes },
      },
    ],
  })

  test("migrate smooth to smooth and not smooth to cusp", () => {
    const scene = parseScene(
      saved([
        { x: 0, y: 0, in: null, out: null, smooth: true },
        { x: 10, y: 0, in: null, out: null, smooth: false },
      ])
    )
    const geometry = scene.objects[0].geometry
    if (geometry.kind !== "path") throw new Error("expected a path")
    expect(geometry.nodes).toEqual([at(0, 0, "smooth"), at(10, 0, "cusp")])
  })

  test("keep every type through a save and load", () => {
    const nodes = (["cusp", "smooth", "symmetric", "auto"] as const).map(
      (type, i) => at(i * 10, 0, type)
    )
    const scene = parseScene(JSON.parse(JSON.stringify(saved(nodes))))
    const geometry = scene.objects[0].geometry
    expect(geometry.kind === "path" && geometry.nodes).toEqual(nodes)
  })

  test("refuse a type that is not one of the four", () => {
    expect(() =>
      parseScene(saved([at(0, 0), { ...at(1, 0), type: "wobbly" as NodeType }]))
    ).toThrow()
  })
})
