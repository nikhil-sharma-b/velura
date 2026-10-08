import { describe, expect, test } from "bun:test"
import {
  BUILTIN_VECTOR_BRUSHES,
  parseVectorBrush,
  type PatternParams,
  type VectorBrush,
} from "../../engine/brush/vector-brush"
import {
  addVectorLayer,
  createBlankDocument,
  findNode,
} from "../../engine/doc/document"
import {
  makePatternBrush,
  patternOutlines,
} from "../../engine/doc/vector-brush"
import type { PathNode } from "../../engine/doc/vector-path"
import type { VectorObject } from "../../engine/doc/vector-scene"
import { tessellateObject, windingAt } from "../../engine/geom/tessellate"
import { serializeSvg } from "../../engine/store/export-svg"

const preset = (name: string): VectorBrush =>
  BUILTIN_VECTOR_BRUSHES.find((b) => b.name === name)!

const square = (x0: number, x1: number, y0 = -0.5, y1 = 0.5) => ({
  kind: "path" as const,
  closed: true,
  nodes: [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ].map(([x, y]) => ({ x, y, in: null, out: null, type: "cusp" as const })),
})

function brush(pattern: Partial<PatternParams>): VectorBrush {
  return parseVectorBrush({
    id: "art",
    name: "Art",
    kind: "pattern",
    params: { ...preset("Solid").params },
    pattern: {
      mode: "repeat",
      corners: "bend",
      tile: { length: 1, paths: [square(0.1, 0.9)] },
      start: null,
      end: null,
      ...pattern,
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
  nodes: PathNode[] = [node(0, 0), node(100, 0)]
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
    brush: { definition, seed: 1 },
  }
}

const bounds = (outlines: { x: number; y: number }[][]) => {
  const all = outlines.flat()
  return {
    minX: Math.min(...all.map((p) => p.x)),
    maxX: Math.max(...all.map((p) => p.x)),
    minY: Math.min(...all.map((p) => p.y)),
    maxY: Math.max(...all.map((p) => p.y)),
  }
}

describe("pattern deformation", () => {
  test("stretch lays one tile end to end, a stroke width across", () => {
    const outlines = patternOutlines(
      stroke(
        brush({ mode: "stretch", tile: { length: 1, paths: [square(0, 1)] } })
      )
    )
    expect(outlines).toHaveLength(1)
    const b = bounds(outlines)
    expect(b.minX).toBeCloseTo(0, 5)
    expect(b.maxX).toBeCloseTo(100, 5)
    expect(b.minY).toBeCloseTo(-5, 5)
    expect(b.maxY).toBeCloseTo(5, 5)
  })

  test("repeat fits a whole number of tiles, each the nearest to its length", () => {
    // Tiles are a stroke width long: 100 / 10 = 10 of them.
    expect(patternOutlines(stroke(brush({})))).toHaveLength(10)
    // 104 rounds to 10 tiles, stretched a little; 116 to 12, squeezed.
    expect(
      patternOutlines(stroke(brush({}), [node(0, 0), node(104, 0)]))
    ).toHaveLength(10)
    expect(
      patternOutlines(stroke(brush({}), [node(0, 0), node(116, 0)]))
    ).toHaveLength(12)
    // A stroke shorter than a tile still has one.
    expect(
      patternOutlines(stroke(brush({}), [node(0, 0), node(3, 0)]))
    ).toHaveLength(1)
  })

  test("caps sit at the ends, and the tile fills between them", () => {
    const cap = (paths = [square(0, 1, -0.5, 0.5)]) => ({ length: 1, paths })
    const outlines = patternOutlines(
      stroke(
        brush({
          mode: "stretch",
          tile: { length: 1, paths: [square(0, 1, -0.1, 0.1)] },
          start: cap(),
          end: cap(),
        })
      )
    )
    expect(outlines).toHaveLength(3)
    const [start, body, end] = outlines.map((o) => bounds([o]))
    expect(start.minX).toBeCloseTo(0, 5)
    expect(start.maxX).toBeCloseTo(10, 5)
    expect(end.minX).toBeCloseTo(90, 5)
    expect(end.maxX).toBeCloseTo(100, 5)
    expect(body.minX).toBeCloseTo(10, 5)
    expect(body.maxX).toBeCloseTo(90, 5)
    expect(body.maxY).toBeCloseTo(1, 5)
  })

  test("caps shrink to share a stroke too short for both", () => {
    const cap = { length: 1, paths: [square(0, 1)] }
    const outlines = patternOutlines(
      stroke(brush({ mode: "stretch", start: cap, end: cap }), [
        node(0, 0),
        node(10, 0),
      ])
    )
    const all = bounds(outlines)
    expect(all.minX).toBeCloseTo(0, 5)
    expect(all.maxX).toBeCloseTo(10, 5)
  })

  test("the art bends round the spine, keeping its width off it", () => {
    // A quarter turn: the art follows it rather than running straight on.
    const outlines = patternOutlines(
      stroke(
        brush({ mode: "stretch", tile: { length: 1, paths: [square(0, 1)] } }),
        [node(0, 0), { ...node(100, 100), in: { x: 100, y: 0 } }]
      )
    )
    const b = bounds(outlines)
    expect(b.maxY).toBeGreaterThan(95)
    expect(b.maxX).toBeLessThan(110)
  })

  test("split corners begin the tiles afresh on each side", () => {
    const corner = [node(0, 0), node(92, 0), node(92, 108)]
    // A tile turns the corner when it is neither all on the first leg nor
    // all on the second.
    const straddles = (outlines: { x: number; y: number }[][]) =>
      outlines.some(
        (o) =>
          !o.every((p) => p.x <= 92 + 1e-6) && !o.every((p) => p.y >= -1e-6)
      )
    // Bent, 200 long is 20 tiles, and one turns the corner.
    const bent = patternOutlines(stroke(brush({ corners: "bend" }), corner))
    expect(bent).toHaveLength(20)
    expect(straddles(bent)).toBe(true)
    // Split, each leg is tiled alone: 9.2 and 10.8 round to 9 and 11.
    const split = patternOutlines(stroke(brush({ corners: "split" }), corner))
    expect(split).toHaveLength(20)
    expect(straddles(split)).toBe(false)
  })

  test("pressure scales the art's thickness when the brush asks", () => {
    const thin = [node(0, 0, 4), node(100, 0, 4)]
    const pressed = brush({ mode: "stretch" })
    expect(bounds(patternOutlines(stroke(pressed, thin))).maxY).toBeCloseTo(5)
    const withPressure = {
      ...pressed,
      params: { ...pressed.params, pressure: true },
    }
    expect(
      bounds(patternOutlines(stroke(withPressure, thin))).maxY
    ).toBeCloseTo(2)
  })

  test("a node edit re-flows the pattern along the new spine", () => {
    const before = patternOutlines(stroke(brush({})))
    const after = patternOutlines(stroke(brush({}), [node(0, 0), node(200, 0)]))
    expect(after).toHaveLength(2 * before.length)
  })

  test("art reaching past a bent stroke's ends extends straight off them", () => {
    const art = brush({
      mode: "stretch",
      tile: { length: 1, paths: [square(-0.2, 1.2)] },
    })
    const outlines = patternOutlines(
      stroke(art, [node(0, 0), node(50, 0), node(50, 50)])
    )
    const points = outlines.flat()
    expect(points.length).toBeGreaterThan(0)
    expect(
      points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    ).toBe(true)
    expect(Math.min(...points.map((p) => p.x))).toBeLessThan(0)
    expect(Math.max(...points.map((p) => p.y))).toBeGreaterThan(50)
  })

  test("a long stroke deforms well within a frame", () => {
    const nodes = Array.from({ length: 200 }, (_, i) =>
      node(i * 20, Math.sin(i / 5) * 40)
    )
    for (const name of ["Ribbon", "Rope", "Vine", "Tapered stroke", "Arrow"]) {
      const object = stroke(preset(name), nodes)
      patternOutlines(object)
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

describe("pattern brushes", () => {
  test("presets round-trip through parsing", () => {
    for (const name of ["Ribbon", "Rope", "Vine", "Tapered stroke", "Arrow"]) {
      expect(preset(name).kind).toBe("pattern")
      expect(parseVectorBrush(preset(name))).toEqual(preset(name))
    }
  })

  test("a pattern brush needs its art", () => {
    expect(() =>
      parseVectorBrush({ ...preset("Rope"), pattern: undefined })
    ).toThrow()
    expect(() =>
      parseVectorBrush({
        ...preset("Rope"),
        pattern: { ...preset("Rope").pattern!, mode: "scatter" },
      })
    ).toThrow()
  })

  test("the selection becomes art on a horizontal axis a stroke wide", () => {
    const art = makePatternBrush([
      {
        id: "a",
        transform: [1, 0, 0, 1, 50, 20],
        geometry: { kind: "rect", x: 0, y: 0, width: 40, height: 10 },
        style: { fill: null, stroke: null },
      },
      {
        id: "b",
        transform: [1, 0, 0, 1, 0, 0],
        geometry: { kind: "ellipse", cx: 100, cy: 25, rx: 10, ry: 5 },
        style: { fill: null, stroke: null },
      },
    ])
    expect(art.kind).toBe("pattern")
    expect(parseVectorBrush(art)).toEqual(art)
    const { tile } = art.pattern!
    // 60 wide by 10 tall: six stroke widths long.
    expect(tile.length).toBeCloseTo(6)
    expect(tile.paths).toHaveLength(2)
    const xs = tile.paths.flatMap((p) => p.nodes.map((n) => n.x))
    const ys = tile.paths.flatMap((p) => p.nodes.map((n) => n.y))
    expect(Math.min(...xs)).toBeCloseTo(0)
    expect(Math.min(...ys)).toBeCloseTo(-0.5)
    expect(Math.max(...ys)).toBeCloseTo(0.5)
  })

  test("SVG export expands the art in a group carrying the spine and brush", () => {
    const doc = createBlankDocument({ width: 200, height: 100 })
    const node = findNode(doc, addVectorLayer(doc))
    if (node.kind !== "vector") throw new Error("Expected a vector layer")
    node.scene = { objects: [stroke(preset("Rope"))] }
    const { svg } = serializeSvg(doc, { raster: "omit" })
    const group = svg.match(
      /<g data-vector-brush="([^"]+)" data-spine="([^"]+)">(.*?)<\/g>/
    )
    expect(group).not.toBeNull()
    const brushData = JSON.parse(group![1].replaceAll("&quot;", '"'))
    expect(brushData.definition.pattern.mode).toBe("repeat")
    expect(group![2]).toBe("M0 0 L100 0")
    expect(group![3].match(/<path /g)).toHaveLength(10)
  })
})

const rect = (
  id: string,
  x: number,
  y: number,
  width: number,
  height: number
): VectorObject => ({
  id,
  transform: [1, 0, 0, 1, 0, 0],
  geometry: { kind: "rect", x, y, width, height },
  style: { fill: null, stroke: null },
})

const line = (
  id: string,
  points: [number, number][],
  closed = false,
  width = 10
): VectorObject => ({
  id,
  transform: [1, 0, 0, 1, 0, 0],
  geometry: {
    kind: "path",
    closed,
    nodes: points.map(([x, y]) => ({
      x,
      y,
      in: null,
      out: null,
      type: "cusp" as const,
    })),
  },
  style: {
    fill: null,
    stroke: {
      color: "#000000",
      opacity: 1,
      width,
      cap: "butt",
      join: "miter",
    },
  },
})

const pieceBounds = (paths: readonly { nodes: readonly PathNode[] }[]) => {
  const xs = paths.flatMap((p) => p.nodes.map((n) => n.x))
  const ys = paths.flatMap((p) => p.nodes.map((n) => n.y))
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  }
}

describe("pattern brush authoring", () => {
  test("selected objects become start and end caps a shared stroke wide", () => {
    const art = makePatternBrush(
      [
        rect("s", 0, 0, 10, 20),
        rect("t", 10, 5, 40, 10),
        rect("e", 50, 0, 20, 20),
      ],
      { start: ["s"], end: ["e"] }
    )
    expect(parseVectorBrush(art)).toEqual(art)
    const { tile, start, end } = art.pattern!
    // All three share the selection's 20 px height as one stroke width.
    expect(start!.length).toBeCloseTo(0.5)
    expect(tile.length).toBeCloseTo(2)
    expect(end!.length).toBeCloseTo(1)
    expect(pieceBounds(tile.paths).minX).toBeCloseTo(0)
    expect(pieceBounds(tile.paths).minY).toBeCloseTo(-0.25)
    expect(pieceBounds(end!.paths).minX).toBeCloseTo(0)
    expect(pieceBounds(end!.paths).minY).toBeCloseTo(-0.5)
  })

  test("a selection that is all caps has no tile to make", () => {
    expect(() =>
      makePatternBrush([rect("s", 0, 0, 10, 10)], { start: ["s"] })
    ).toThrow()
  })

  test("a vertical axis runs the art top to bottom", () => {
    const art = makePatternBrush([rect("a", 0, 0, 10, 60)], {
      axis: "vertical",
    })
    expect(art.pattern!.tile.length).toBeCloseTo(6)
    const b = pieceBounds(art.pattern!.tile.paths)
    expect(b.minX).toBeCloseTo(0)
    expect(b.maxX).toBeCloseTo(6)
    expect(b.minY).toBeCloseTo(-0.5)
    expect(b.maxY).toBeCloseTo(0.5)
  })

  test("a drawn axis line sets the spine and is left out of the art", () => {
    // A 60 by 10 bar turned 90°, with an axis drawn down its middle.
    const art = makePatternBrush(
      [
        rect("a", 0, 0, 10, 60),
        line(
          "axis",
          [
            [5, 0],
            [5, 60],
          ],
          false,
          1
        ),
      ],
      { axis: { drawn: "axis" } }
    )
    const { tile } = art.pattern!
    expect(tile.paths).toHaveLength(1)
    expect(tile.length).toBeCloseTo(6)
    const b = pieceBounds(tile.paths)
    expect(b.minY).toBeCloseTo(-0.5)
    expect(b.maxY).toBeCloseTo(0.5)
  })

  test("a drawn axis must be one of the selected open paths", () => {
    expect(() =>
      makePatternBrush([rect("a", 0, 0, 10, 60)], { axis: { drawn: "a" } })
    ).toThrow()
  })

  test("an open stroked path keeps its line as outlined art", () => {
    const art = makePatternBrush([
      line("l", [
        [0, 0],
        [100, 0],
      ]),
    ])
    const { tile } = art.pattern!
    expect(tile.length).toBeCloseTo(10)
    expect(tile.paths).toHaveLength(1)
    expect(tile.paths[0].closed).toBe(true)
    const b = pieceBounds(tile.paths)
    expect(b.minY).toBeCloseTo(-0.5)
    expect(b.maxY).toBeCloseTo(0.5)
  })

  test("a closed stroke-only shape keeps a ring, not a filled disc", () => {
    const art = makePatternBrush([
      line(
        "r",
        [
          [0, 0],
          [100, 0],
          [100, 100],
          [0, 100],
        ],
        true
      ),
    ])
    const { tile } = art.pattern!
    expect(tile.paths).toHaveLength(2)
    const object: VectorObject = {
      ...stroke(art),
      geometry: {
        kind: "path",
        closed: false,
        nodes: [node(0, 0, 100), node(110, 0, 100)],
      },
      style: {
        fill: null,
        stroke: { ...stroke(art).style.stroke!, width: 100 },
      },
    }
    const mesh = tessellateObject(object).stroke!
    // The ring's middle is empty; its band is solid.
    expect(windingAt(mesh, 55, 0)).toBe(0)
    expect(windingAt(mesh, 2, 0)).not.toBe(0)
  })
})
