import { describe, expect, test } from "bun:test"
import {
  BUILTIN_VECTOR_BRUSHES,
  parseVectorBrush,
  type VectorBrush,
} from "../../engine/brush/vector-brush"
import {
  addVectorLayer,
  createBlankDocument,
  findNode,
} from "../../engine/doc/document"
import {
  createVelocityThinning,
  vectorBrushObject,
} from "../../engine/doc/vector-brush"
import type { VectorObject } from "../../engine/doc/vector-scene"
import { serializeSvg } from "../../engine/store/export-svg"

const preset = (name: string): VectorBrush =>
  BUILTIN_VECTOR_BRUSHES.find((b) => b.name === name)!

function stroke(brush: VectorBrush, seed = 1): VectorObject {
  return {
    id: "s",
    transform: [1, 0, 0, 1, 0, 0],
    geometry: {
      kind: "path",
      closed: false,
      nodes: [
        { x: 0, y: 50, in: null, out: null, type: "cusp", width: 6 },
        { x: 200, y: 50, in: null, out: null, type: "cusp", width: 12 },
      ],
    },
    style: {
      fill: null,
      stroke: {
        color: "#000000",
        opacity: 1,
        width: 12,
        cap: "round",
        join: "round",
      },
    },
    brush: { definition: brush, seed },
  }
}

const nodesOf = (object: VectorObject) => {
  const g = vectorBrushObject(object).geometry
  if (g.kind !== "path") throw new Error("Expected a path")
  return g.nodes
}

describe("profile parameters", () => {
  test("a brush saved before profiles gains neutral defaults", () => {
    const brush = parseVectorBrush({
      id: "old",
      name: "Old",
      kind: "profile",
      params: { pressure: true, taper: { start: 0.1, end: 0 } },
    })
    expect(brush.params).toEqual({
      pressure: true,
      pressureCurve: 1,
      thinning: 0,
      minWidth: 0,
      taper: { start: 0.1, end: 0 },
      caps: "style",
      smoothing: 0,
      tremor: 0,
      wiggle: 0,
      nibAngle: 45,
      fixation: 1,
    })
  })

  test("out-of-range profile parameters are refused", () => {
    for (const bad of [
      { pressureCurve: 0 },
      { thinning: 2 },
      { minWidth: -1 },
      { caps: "square" },
      { tremor: Number.NaN },
    ])
      expect(() =>
        parseVectorBrush({
          ...preset("Pressure"),
          params: { ...preset("Pressure").params, ...bad },
        })
      ).toThrow()
  })

  test("every preset family is built in and valid", () => {
    for (const name of [
      "Fineliner",
      "Technical pen",
      "Dip pen",
      "Brush pen",
      "Marker",
      "Wiggly",
      "Splotchy",
    ])
      expect(parseVectorBrush(preset(name))).toEqual(preset(name))
  })
})

describe("velocity thinning", () => {
  const run = (thinning: number, step: number) => {
    const thin = createVelocityThinning(thinning)
    let last = 1
    for (let i = 0; i < 20; i++) last = thin(i * step, 0, 1, i * 4)
    return last
  }

  test("a faster hand draws a thinner line", () => {
    expect(run(0.6, 10)).toBeLessThan(run(0.6, 1))
  })

  test("no thinning leaves pressure alone", () => {
    expect(run(0, 10)).toBe(1)
  })

  test("thinning is repeatable", () => {
    expect(run(0.6, 7)).toBe(run(0.6, 7))
  })
})

describe("profile derivation", () => {
  test("pressure curve and minimum width shape node widths", () => {
    const soft = {
      ...preset("Pressure"),
      params: {
        ...preset("Pressure").params,
        pressureCurve: 2,
        minWidth: 0.25,
      },
    }
    const [first, last] = [
      nodesOf(stroke(soft))[0],
      nodesOf(stroke(soft)).at(-1)!,
    ]
    // p = 0.5 → 0.25 curved → lifted to a quarter floor: 12 × (0.25 + 0.75 × 0.25)
    expect(first.width).toBeCloseTo(12 * (0.25 + 0.75 * 0.25))
    expect(last.width).toBeCloseTo(12)
  })

  test("tremor and wiggle are deterministic per seed", () => {
    for (const name of ["Splotchy", "Wiggly"]) {
      const a = nodesOf(stroke(preset(name), 7))
      const b = nodesOf(stroke(preset(name), 7))
      const c = nodesOf(stroke(preset(name), 8))
      expect(a).toEqual(b)
      expect(a).not.toEqual(c)
    }
  })

  test("tremor varies width without moving the spine", () => {
    const nodes = nodesOf(stroke(preset("Splotchy"), 3))
    expect(new Set(nodes.map((n) => n.width!.toFixed(3))).size).toBeGreaterThan(
      3
    )
    expect(nodes.every((n) => n.y === 50)).toBe(true)
  })

  test("wiggle moves nodes along the normal, within its amplitude", () => {
    const object = stroke(preset("Wiggly"), 3)
    const nodes = nodesOf(object)
    const off = nodes.map((n) => Math.abs(n.y - 50))
    expect(Math.max(...off)).toBeGreaterThan(0.5)
    expect(Math.max(...off)).toBeLessThanOrEqual(
      preset("Wiggly").params.wiggle * 12 + 1e-9
    )
    // The stored spine is untouched.
    expect(object.geometry).toEqual(stroke(preset("Wiggly"), 3).geometry)
  })

  test("caps follow the brush", () => {
    expect(
      vectorBrushObject(stroke(preset("Technical pen"))).style.stroke!.cap
    ).toBe("butt")
    expect(
      vectorBrushObject(stroke(preset("Fineliner"))).style.stroke!.cap
    ).toBe("round")
  })

  test("node edits re-derive the profile", () => {
    const object = stroke(preset("Wiggly"), 5)
    const before = nodesOf(object)
    const g = object.geometry
    if (g.kind !== "path") throw new Error("Expected a path")
    const edited: VectorObject = {
      ...object,
      geometry: {
        ...g,
        nodes: [g.nodes[0], { ...g.nodes[1], x: 300, y: 120 }],
      },
    }
    const after = nodesOf(edited)
    expect(after).not.toEqual(before)
    // The end follows the moved node, give or take the wiggle.
    const end = after.at(-1)!
    expect(Math.hypot(end.x - 300, end.y - 120)).toBeLessThanOrEqual(
      preset("Wiggly").params.wiggle * 12 + 1e-9
    )
    // Same input, same output: derivation holds no hidden state.
    expect(nodesOf(edited)).toEqual(after)
  })
})

test("SVG export writes profile strokes as filled outline paths", () => {
  const doc = createBlankDocument({ width: 220, height: 100 })
  const id = addVectorLayer(doc)
  const node = findNode(doc, id)
  if (node.kind !== "vector") throw new Error("Expected vector")
  for (const name of ["Fineliner", "Brush pen", "Wiggly"]) {
    node.scene = { objects: [stroke(preset(name), 2)] }
    const { svg } = serializeSvg(doc, { raster: "omit" })
    expect(svg).toMatch(
      /<path d="M[^"]+" fill="#000000" fill-opacity="1" fill-rule="nonzero" stroke="none"\/>/
    )
    expect(svg).toContain("data-vector-brush=")
  }
})

test("a closed path's closing segment gets noise too", () => {
  const object = stroke(preset("Wiggly"), 4)
  const g = object.geometry
  if (g.kind !== "path") throw new Error("Expected a path")
  const closed: VectorObject = {
    ...object,
    geometry: {
      ...g,
      closed: true,
      nodes: [
        ...g.nodes,
        { x: 100, y: 150, in: null, out: null, type: "cusp", width: 9 },
      ],
    },
  }
  const nodes = nodesOf(closed)
  // Some derived node sits on the 100,150 → 0,50 closing segment, past the last spine node.
  const last = nodes.findIndex(
    (n, i) => i > 0 && Math.abs(n.x - 100) < 8 && n.y > 140
  )
  expect(nodes.slice(last + 1).length).toBeGreaterThan(3)
})
