import { expect, test } from "bun:test"
import { serializeSvg } from "../../engine/store/export-svg"
import {
  createBlankDocument,
  addVectorLayer,
  findNode,
} from "../../engine/doc/document"
import type { VectorObject } from "../../engine/doc/vector-scene"

type Point = { x: number; y: number }

/** A pressure stroke: drawn by its mesh, so exported as an outline. */
function stroke(
  points: readonly Point[],
  width = 6,
  cap: "round" | "butt" = "round"
): VectorObject {
  return {
    id: "stroke",
    geometry: {
      kind: "path",
      closed: false,
      nodes: points.map((p) => ({
        ...p,
        width,
        in: null,
        out: null,
        type: "cusp" as const,
      })),
    },
    transform: [1, 0, 0, 1, 0, 0],
    style: {
      fill: null,
      stroke: {
        color: "#000000",
        opacity: 1,
        width,
        cap,
        join: "round",
      },
    },
  }
}

/** The outline's rings, from the export of one stroke. */
function outline(object: VectorObject): Point[][] {
  const doc = createBlankDocument({ width: 200, height: 200 })
  const id = addVectorLayer(doc)
  const node = findNode(doc, id)
  if (node.kind !== "vector") throw new Error("Expected vector")
  node.scene = { objects: [object] }
  const { svg } = serializeSvg(doc, { raster: "omit" })
  const paths = [
    ...svg.matchAll(/<path d="([^"]+)"[^>]*fill-rule="nonzero" stroke="none"/g),
  ]
  expect(paths).toHaveLength(1)
  return paths[0][1]
    .split("Z")
    .map((ring) => ring.trim())
    .filter(Boolean)
    .map((ring) => {
      expect(ring.startsWith("M")).toBe(true)
      const values = ring.replace(/[ML]/g, " ").trim().split(/\s+/).map(Number)
      const points: Point[] = []
      for (let i = 0; i < values.length; i += 2)
        points.push({ x: values[i], y: values[i + 1] })
      return points
    })
}

/** Even-odd inside test; the rings do not overlap, so it agrees with nonzero. */
function inside(rings: Point[][], x: number, y: number) {
  let crossings = 0
  for (const ring of rings)
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i],
        b = ring[j]
      if (
        a.y > y !== b.y > y &&
        x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x
      )
        crossings++
    }
  return crossings % 2 === 1
}

test("a straight stroke exports one ring with straight edges merged", () => {
  const rings = outline(
    stroke(
      [
        { x: 10, y: 50 },
        { x: 60, y: 50 },
        { x: 110, y: 50 },
      ],
      6,
      "butt"
    )
  )
  expect(rings).toHaveLength(1)
  // A butt-capped straight band is a rectangle.
  expect(rings[0]).toHaveLength(4)
  expect(inside(rings, 60, 50)).toBe(true)
  expect(inside(rings, 60, 54)).toBe(false)
})

test("a curved stroke exports one ring that follows the curve", () => {
  const points = Array.from({ length: 20 }, (_, i) => ({
    x: 20 + i * 8,
    y: 100 + Math.sin(i / 3) * 40,
  }))
  const rings = outline(stroke(points))
  expect(rings).toHaveLength(1)
  for (const p of points) expect(inside(rings, p.x, p.y)).toBe(true)
  expect(inside(rings, 100, 20)).toBe(false)
})

test("a stroke that loops over itself keeps the hole it encloses", () => {
  const rings = outline(
    stroke([
      { x: 20, y: 100 },
      { x: 150, y: 100 },
      { x: 150, y: 20 },
      { x: 60, y: 20 },
      { x: 60, y: 160 },
    ])
  )
  expect(rings).toHaveLength(2)
  // Filled nonzero, the hole must wind against the outer ring.
  const area = (ring: Point[]) =>
    ring.reduce((sum, p, i) => {
      const q = ring[(i + 1) % ring.length]
      return sum + p.x * q.y - q.x * p.y
    }, 0)
  expect(Math.sign(area(rings[0]))).toBe(-Math.sign(area(rings[1])))
  expect(inside(rings, 100, 60)).toBe(false)
  // Where the stroke crosses itself it is filled once, not cancelled.
  expect(inside(rings, 60, 100)).toBe(true)
  expect(inside(rings, 150, 60)).toBe(true)
})

test("a single dab exports one ring", () => {
  const rings = outline(stroke([{ x: 50, y: 50 }], 0.6))
  expect(rings).toHaveLength(1)
  expect(inside(rings, 50, 50)).toBe(true)
  expect(inside(rings, 50, 60)).toBe(false)
})

test("a dab under a pixel across is kept", () => {
  const rings = outline(stroke([{ x: 50, y: 50 }], 0.6))
  expect(rings).toHaveLength(1)
  expect(rings[0].length).toBeGreaterThanOrEqual(3)
})
