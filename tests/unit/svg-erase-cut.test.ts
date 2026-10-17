import { expect, test } from "bun:test"
import { serializeSvg } from "../../engine/store/export-svg"
import {
  createBlankDocument,
  addVectorLayer,
  findNode,
} from "../../engine/doc/document"
import type { VectorObject } from "../../engine/doc/vector-scene"

const fill = { color: "#ff0000", opacity: 1, rule: "nonzero" } as const
const identity = [1, 0, 0, 1, 0, 0] as const

function rect(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number
): VectorObject {
  return {
    id,
    geometry: { kind: "rect", x, y, width, height },
    transform: [...identity],
    style: { fill, stroke: null },
  }
}

/** An eraser's mark: a filled rectangle drawn with `erase`. */
function eraser(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number
): VectorObject {
  return { ...rect(id, x, y, width, height), erase: true }
}

function exportScene(objects: VectorObject[]): string {
  const doc = createBlankDocument({ width: 100, height: 100 })
  const id = addVectorLayer(doc)
  const node = findNode(doc, id)
  if (node.kind !== "vector") throw new Error("Expected vector")
  node.scene = { objects }
  return serializeSvg(doc, { raster: "omit" }).svg
}

/** The polygon `d`s the export wrote, as rings of points. */
function cutPaths(svg: string): { x: number; y: number }[][][] {
  return [...svg.matchAll(/<path d="([^"]+)"[^>]*fill-rule="evenodd"/g)].map(
    ([, d]) =>
      d
        .split("Z")
        .map((ring) => ring.trim())
        .filter(Boolean)
        .map((ring) =>
          ring
            .replace(/[ML]/g, " ")
            .trim()
            .split(/\s+/)
            .map(Number)
            .reduce<{ x: number; y: number }[]>((points, value, i, all) => {
              if (i % 2 === 0) points.push({ x: value, y: all[i + 1] })
              return points
            }, [])
        )
  )
}

/** Even-odd inside test over all of a path's rings. */
function inside(rings: { x: number; y: number }[][], x: number, y: number) {
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

test("with no erase, shapes are written as before and there is no mask", () => {
  const svg = exportScene([rect("a", 0, 0, 10, 10)])
  expect(svg).not.toContain("<mask")
  expect(svg).toContain(
    '<rect x="0" y="0" width="10" height="10" transform="matrix(1 0 0 1 0 0)" fill="#ff0000"'
  )
})

test("an erase partly over one shape cuts it, with no mask", () => {
  const svg = exportScene([rect("a", 0, 0, 10, 10), eraser("e", 5, 0, 10, 10)])
  expect(svg).not.toContain("<mask")
  expect(svg).not.toContain('<rect x="0"')
  const [path] = cutPaths(svg)
  expect(path).toBeDefined()
  expect(inside(path, 2, 5)).toBe(true)
  expect(inside(path, 7, 5)).toBe(false)
  expect(svg).toMatch(/fill="#ff0000" fill-opacity="1" fill-rule="evenodd"/)
})

test("an erase over two shapes cuts both and leaves an untouched one as is", () => {
  const untouched = exportScene([rect("c", 60, 60, 10, 10)]).match(
    /<rect x="60"[^>]*\/>/
  )![0]
  const svg = exportScene([
    rect("a", 0, 0, 10, 10),
    rect("b", 20, 0, 10, 10),
    rect("c", 60, 60, 10, 10),
    eraser("e", 5, 0, 20, 10),
  ])
  expect(svg).not.toContain("<mask")
  const paths = cutPaths(svg)
  expect(paths).toHaveLength(2)
  expect(inside(paths[0], 2, 5)).toBe(true)
  expect(inside(paths[0], 7, 5)).toBe(false)
  expect(inside(paths[1], 27, 5)).toBe(true)
  expect(inside(paths[1], 22, 5)).toBe(false)
  expect(svg).toContain(untouched)
})

test("a shape an erase covers entirely is dropped; later shapes stay", () => {
  const svg = exportScene([
    rect("a", 10, 10, 10, 10),
    eraser("e", 0, 0, 50, 50),
    rect("over", 20, 20, 10, 10),
  ])
  expect(svg).not.toContain("<mask")
  expect(svg).not.toContain('<rect x="10"')
  expect(cutPaths(svg)).toHaveLength(0)
  expect(svg).toContain('<rect x="20" y="20"')
})

test("an erase through the middle of a shape leaves a hole", () => {
  const svg = exportScene([
    rect("a", 0, 0, 30, 30),
    eraser("e", 10, 10, 10, 10),
  ])
  const paths = cutPaths(svg)
  expect(paths).toHaveLength(1)
  expect(paths[0]).toHaveLength(2)
  expect(inside(paths[0], 5, 5)).toBe(true)
  expect(inside(paths[0], 15, 15)).toBe(false)
})

test("later erases subtract from what earlier ones left", () => {
  const svg = exportScene([
    rect("a", 0, 0, 30, 10),
    eraser("e1", 0, 0, 10, 10),
    eraser("e2", 20, 0, 10, 10),
  ])
  const [path] = cutPaths(svg)
  expect(inside(path, 5, 5)).toBe(false)
  expect(inside(path, 15, 5)).toBe(true)
  expect(inside(path, 25, 5)).toBe(false)
})

test("a stroke under an erase is cut as its outline", () => {
  const svg = exportScene([
    {
      id: "line",
      geometry: {
        kind: "polygon",
        points: [
          { x: 0, y: 50 },
          { x: 100, y: 50 },
        ],
        closed: false,
      },
      transform: [...identity],
      style: {
        fill: null,
        stroke: {
          color: "#00ff00",
          opacity: 0.5,
          width: 10,
          cap: "butt",
          join: "miter",
        },
      },
    },
    eraser("e", 40, 0, 20, 100),
  ])
  expect(svg).not.toContain("<mask")
  const [path] = cutPaths(svg)
  expect(svg).toMatch(/fill="#00ff00" fill-opacity="0.5" fill-rule="evenodd"/)
  expect(inside(path, 20, 50)).toBe(true)
  expect(inside(path, 50, 50)).toBe(false)
  expect(inside(path, 80, 50)).toBe(true)
  expect(inside(path, 20, 60)).toBe(false)
})

test("a shape whose box an erase meets, but not the shape, is written as is", () => {
  const ring: VectorObject = {
    id: "dot",
    geometry: { kind: "ellipse", cx: 10, cy: 10, rx: 10, ry: 10 },
    transform: [...identity],
    style: { fill, stroke: null },
  }
  const svg = exportScene([ring, eraser("corner", 18, 18, 4, 4)])
  expect(svg).toContain('<ellipse cx="10" cy="10" rx="10" ry="10"')
  expect(cutPaths(svg)).toHaveLength(0)
})

test("a partly transparent eraser keeps one mask over the shapes it meets", () => {
  const half = eraser("e", 5, 0, 10, 10)
  const svg = exportScene([
    rect("a", 0, 0, 10, 10),
    rect("far", 60, 60, 10, 10),
    { ...half, style: { fill: { ...fill, opacity: 0.5 }, stroke: null } },
  ])
  expect(svg.match(/<mask /g)).toHaveLength(1)
  expect(svg).toMatch(
    /<g mask="url\(#[^"]+\)"><rect x="0"[^>]*\/><\/g><rect x="60"/
  )
})
