import { describe, expect, test } from "bun:test"
import {
  BUILTIN_VECTOR_BRUSHES,
  parseVectorBrush,
  type ScatterParams,
  type VectorBrush,
} from "../../engine/brush/vector-brush"
import {
  addVectorLayer,
  createBlankDocument,
  findNode,
} from "../../engine/doc/document"
import {
  makeScatterBrush,
  scatterOutlines,
} from "../../engine/doc/vector-brush"
import type { PathNode } from "../../engine/doc/vector-path"
import type { Point, VectorObject } from "../../engine/doc/vector-scene"
import { tessellateObject } from "../../engine/geom/tessellate"
import { serializeSvg } from "../../engine/store/export-svg"

const preset = (name: string): VectorBrush =>
  BUILTIN_VECTOR_BRUSHES.find((b) => b.name === name)!

/** A one-by-one square of art, so each copy is one outline. */
function brush(scatter: Partial<ScatterParams>, pressure = false): VectorBrush {
  return parseVectorBrush({
    id: "art",
    name: "Art",
    kind: "scatter",
    params: { ...preset("Solid").params, pressure },
    scatter: {
      art: {
        length: 1,
        paths: [
          {
            kind: "path",
            closed: true,
            nodes: [
              [0, -0.5],
              [1, -0.5],
              [1, 0.5],
              [0, 0.5],
            ].map(([x, y]) => ({ x, y, in: null, out: null, type: "cusp" })),
          },
        ],
      },
      spacing: 2,
      size: 1,
      sizeJitter: 0,
      rotationJitter: 0,
      offsetJitter: 0,
      align: false,
      ...scatter,
    },
  })
}

const node = (x: number, y: number, width = 10): PathNode => ({
  x,
  y,
  in: null,
  out: null,
  type: "cusp",
  width,
})

function stroke(
  definition: VectorBrush,
  nodes: PathNode[] = [node(0, 0), node(100, 0)],
  seed = 1
): VectorObject {
  return {
    id: "s",
    transform: [1, 0, 0, 1, 0, 0],
    geometry: { kind: "path", closed: false, nodes },
    style: {
      fill: null,
      stroke: {
        color: "#000000",
        opacity: 1,
        width: 10,
        cap: "round",
        join: "round",
      },
    },
    brush: { definition, seed },
  }
}

const centre = (outline: Point[]): Point => ({
  x: outline.reduce((sum, p) => sum + p.x, 0) / outline.length,
  y: outline.reduce((sum, p) => sum + p.y, 0) / outline.length,
})
const side = (outline: Point[]) =>
  Math.hypot(outline[1].x - outline[0].x, outline[1].y - outline[0].y)

describe("scatter placement", () => {
  test("copies sit a spacing apart from the stroke's start, on the spine", () => {
    const copies = scatterOutlines(stroke(brush({})))
    // A 100 px stroke, 20 px apart: 0, 20, … 100.
    expect(copies).toHaveLength(6)
    copies.forEach((copy, i) => {
      expect(centre(copy).x).toBeCloseTo(i * 20)
      expect(centre(copy).y).toBeCloseTo(0)
      expect(side(copy)).toBeCloseTo(10)
    })
  })

  test("jitter is the same for the same seed, and differs for another", () => {
    const jittery = brush({
      sizeJitter: 0.5,
      rotationJitter: 1,
      offsetJitter: 1,
    })
    const once = scatterOutlines(stroke(jittery))
    expect(scatterOutlines(stroke(jittery))).toEqual(once)
    expect(scatterOutlines(stroke(jittery, undefined, 2))).not.toEqual(once)
    const sizes = once.map(side)
    expect(Math.max(...sizes)).toBeLessThanOrEqual(15 + 1e-9)
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(5 - 1e-9)
    expect(new Set(sizes.map((s) => s.toFixed(3))).size).toBeGreaterThan(1)
    for (const copy of once)
      expect(Math.abs(centre(copy).y)).toBeLessThanOrEqual(10 + 1e-9)
  })

  test("a node edit re-places copies with the same seed", () => {
    const jittery = brush({ sizeJitter: 0.5, rotationJitter: 1 })
    const before = scatterOutlines(stroke(jittery))
    const after = scatterOutlines(stroke(jittery, [node(0, 0), node(200, 0)]))
    expect(after).toHaveLength(11)
    // The copies the strokes share are the same copies.
    expect(after.slice(0, before.length)).toEqual(before)
    const bent = scatterOutlines(
      stroke(jittery, [node(0, 0), node(50, 0), node(50, 50)])
    )
    bent.forEach((copy, i) => expect(side(copy)).toBeCloseTo(side(before[i])))
  })

  test("aligned copies turn with the stroke; upright ones do not", () => {
    const down = [node(0, 0), node(0, 100)]
    const upright = scatterOutlines(stroke(brush({}), down))[1]
    const aligned = scatterOutlines(stroke(brush({ align: true }), down))[1]
    // The square's first edge runs along the art's axis.
    expect(aligned[1].y - aligned[0].y).toBeCloseTo(10)
    expect(upright[1].x - upright[0].x).toBeCloseTo(10)
  })

  test("pressure scales each copy when the brush asks", () => {
    const light = [node(0, 0, 4), node(100, 0, 4)]
    expect(
      side(scatterOutlines(stroke(brush({}, true), light))[0])
    ).toBeCloseTo(4)
    expect(side(scatterOutlines(stroke(brush({}), light))[0])).toBeCloseTo(10)
  })

  test("a long stroke scatters well within a frame", () => {
    const nodes = Array.from({ length: 200 }, (_, i) =>
      node(i * 20, Math.sin(i / 5) * 40)
    )
    for (const name of ["Dots", "Stars", "Confetti", "Leaves", "Hearts"]) {
      const object = stroke(preset(name), nodes)
      scatterOutlines(object)
      // The best of a few runs, so a busy machine's hiccup does not count.
      const times = Array.from({ length: 5 }, () => {
        const t = performance.now()
        tessellateObject(object)
        return performance.now() - t
      })
      // The absolute D30 latency target is tracked in 14-d30-performance.md.
      expect(Math.min(...times)).toBeLessThan(8)
    }
  })
})

describe("scatter brushes", () => {
  test("presets round-trip through parsing", () => {
    for (const name of ["Dots", "Stars", "Confetti", "Leaves", "Hearts"]) {
      const brush = preset(name)
      expect(brush.kind).toBe("scatter")
      expect(parseVectorBrush(brush)).toEqual(brush)
    }
  })

  test("a scatter brush needs its art and spacing in range", () => {
    const { scatter, ...rest } = preset("Dots")
    expect(() => parseVectorBrush(rest)).toThrow(/scatter brush/)
    expect(() =>
      parseVectorBrush({ ...rest, scatter: { ...scatter, spacing: 0 } })
    ).toThrow(/scatter brush/)
  })

  test("the selection becomes upright art a stroke wide", () => {
    const art = makeScatterBrush([
      {
        id: "a",
        transform: [1, 0, 0, 1, 50, 20],
        geometry: { kind: "rect", x: 0, y: 0, width: 20, height: 10 },
        style: { fill: null, stroke: null },
      },
    ])
    expect(art.kind).toBe("scatter")
    expect(parseVectorBrush(art)).toEqual(art)
    expect(art.scatter!.art.length).toBeCloseTo(2)
    expect(art.scatter!.align).toBe(false)
  })

  test("SVG export expands the copies in a group carrying the spine and brush", () => {
    const doc = createBlankDocument({ width: 200, height: 100 })
    const layer = findNode(doc, addVectorLayer(doc))
    if (layer.kind !== "vector") throw new Error("Expected a vector layer")
    layer.scene = { objects: [stroke(brush({}))] }
    const { svg } = serializeSvg(doc, { raster: "omit" })
    const group = svg.match(
      /<g data-vector-brush="([^"]+)" data-spine="([^"]+)">(.*?)<\/g>/
    )
    expect(group).not.toBeNull()
    const brushData = JSON.parse(group![1].replaceAll("&quot;", '"'))
    expect(brushData.definition.kind).toBe("scatter")
    expect(group![2]).toBe("M0 0 L100 0")
    expect(group![3].match(/<path /g)).toHaveLength(6)
  })
})
