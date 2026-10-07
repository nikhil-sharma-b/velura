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
  createTiltDirection,
  nibAngle,
  nibWidth,
  vectorBrushObject,
} from "../../engine/doc/vector-brush"
import { parseScene, type VectorObject } from "../../engine/doc/vector-scene"
import { serializeSvg } from "../../engine/store/export-svg"

const preset = (name: string): VectorBrush =>
  BUILTIN_VECTOR_BRUSHES.find((b) => b.name === name)!

const DEG = Math.PI / 180

function stroke(
  brush: VectorBrush,
  to: { x: number; y: number },
  tilt?: number
): VectorObject {
  return {
    id: "s",
    transform: [1, 0, 0, 1, 0, 0],
    geometry: {
      kind: "path",
      closed: false,
      nodes: [
        { x: 0, y: 0, in: null, out: null, type: "cusp", width: 10 },
        { ...to, in: null, out: null, type: "cusp", width: 10 },
      ],
    },
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
    brush: {
      definition: brush,
      seed: 1,
      ...(tilt === undefined ? {} : { tilt }),
    },
  }
}

const widthsOf = (object: VectorObject) => {
  const g = vectorBrushObject(object).geometry
  if (g.kind !== "path") throw new Error("Expected a path")
  return g.nodes.map((n) => n.width!)
}

const nib = (params: Partial<VectorBrush["params"]>): VectorBrush =>
  parseVectorBrush({
    id: "nib",
    name: "Nib",
    kind: "calligraphy",
    params: {
      pressure: false,
      taper: { start: 0, end: 0 },
      minWidth: 0.1,
      nibAngle: 45,
      fixation: 1,
      ...params,
    },
  })

describe("the nib width", () => {
  test("is widest across the nib and thinnest along it", () => {
    expect(nibWidth(90 * DEG, 0, 0.1)).toBeCloseTo(1)
    expect(nibWidth(0, 0, 0.1)).toBeCloseTo(0.1)
    expect(nibWidth(Math.PI, 0, 0.1)).toBeCloseTo(0.1)
    expect(nibWidth(30 * DEG, 0, 0)).toBeCloseTo(0.5)
    expect(nibWidth(30 * DEG, 0, 0.2)).toBeCloseTo(0.2 + 0.8 * 0.5)
  })

  test("is the same both ways along a line", () => {
    expect(nibWidth(20 * DEG, 45 * DEG, 0.1)).toBeCloseTo(
      nibWidth(200 * DEG, 45 * DEG, 0.1)
    )
  })
})

describe("the fixation blend", () => {
  test("a fixed nib ignores tilt, a free nib follows it", () => {
    expect(nibAngle(30 * DEG, 80 * DEG, 1)).toBeCloseTo(30 * DEG)
    expect(nibAngle(30 * DEG, 80 * DEG, 0)).toBeCloseTo(80 * DEG)
    expect(nibAngle(30 * DEG, 80 * DEG, 0.5)).toBeCloseTo(55 * DEG)
  })

  test("without tilt the nib stays fixed", () => {
    expect(nibAngle(30 * DEG, undefined, 0)).toBeCloseTo(30 * DEG)
  })

  test("blends the short way round, as a nib turned half way is the same nib", () => {
    // 170° is 10° short of 0°, so halfway from 0° is -5°, not 85°.
    const angle = nibAngle(0, 170 * DEG, 0.5)
    expect(Math.abs(Math.sin(angle - -5 * DEG))).toBeLessThan(1e-9)
  })
})

describe("the tilt direction of a stroke", () => {
  test("is unknown from a mouse, which never tilts", () => {
    const tilt = createTiltDirection()
    tilt.add(0, 0)
    tilt.add(0, 0)
    expect(tilt.angle()).toBeUndefined()
  })

  test("averages a pen's tilt, either way along the nib alike", () => {
    const tilt = createTiltDirection()
    tilt.add(30, 0)
    tilt.add(-30, 0)
    tilt.add(30, 1)
    const angle = tilt.angle()!
    expect(Math.abs(Math.sin(angle))).toBeLessThan(0.05)
  })
})

describe("calligraphy strokes", () => {
  test("a horizontal stroke with a 45° nib is about 0.1 + 0.9·sin 45° wide", () => {
    const widths = widthsOf(stroke(nib({}), { x: 200, y: 0 }))
    const expected = 10 * (0.1 + 0.9 * Math.SQRT1_2)
    for (const w of widths) expect(w).toBeCloseTo(expected, 5)
  })

  test("strokes along the nib are thin and across it are full", () => {
    const along = widthsOf(stroke(nib({ nibAngle: 0 }), { x: 200, y: 0 }))
    const across = widthsOf(stroke(nib({ nibAngle: 0 }), { x: 0, y: 200 }))
    expect(Math.max(...along)).toBeCloseTo(1)
    expect(Math.min(...across)).toBeCloseTo(10)
  })

  test("a free nib follows the stroke's tilt, and falls back without one", () => {
    const free = nib({ nibAngle: 0, fixation: 0 })
    const withPen = widthsOf(stroke(free, { x: 200, y: 0 }, 90 * DEG))
    const withMouse = widthsOf(stroke(free, { x: 200, y: 0 }))
    expect(Math.min(...withPen)).toBeCloseTo(10)
    expect(Math.max(...withMouse)).toBeCloseTo(1)
  })

  test("pressure scales the nib", () => {
    const pressed = stroke(nib({ nibAngle: 0, pressure: true }), {
      x: 0,
      y: 200,
    })
    if (pressed.geometry.kind !== "path") throw new Error("Expected a path")
    const light: VectorObject = {
      ...pressed,
      geometry: {
        ...pressed.geometry,
        nodes: pressed.geometry.nodes.map((n) => ({ ...n, width: 5 })),
      },
    }
    expect(Math.max(...widthsOf(light))).toBeCloseTo(5)
  })

  test("caps are set by the brush", () => {
    const flat = vectorBrushObject(
      stroke(nib({ caps: "flat" }), { x: 200, y: 0 })
    )
    expect(flat.style.stroke!.cap).toBe("butt")
  })

  test("a curve is split so the width turns with it", () => {
    const object = stroke(nib({ nibAngle: 0 }), { x: 200, y: 0 })
    const curved = {
      ...object,
      geometry: {
        kind: "path",
        closed: false,
        nodes: [
          { x: 0, y: 0, in: null, out: { x: 0, y: 100 }, type: "cusp" },
          { x: 200, y: 0, in: { x: 200, y: 100 }, out: null, type: "cusp" },
        ],
      },
    } as VectorObject
    const widths = widthsOf(curved)
    expect(widths.length).toBeGreaterThan(4)
    expect(Math.max(...widths)).toBeCloseTo(10, 0)
    expect(Math.min(...widths)).toBeLessThan(2)
  })

  test("the stroke's tilt is saved with it", () => {
    const scene = parseScene({
      objects: [stroke(nib({}), { x: 200, y: 0 }, 1.25)],
    })
    expect(scene.objects[0].brush?.tilt).toBe(1.25)
    expect(() =>
      parseScene({
        objects: [stroke(nib({}), { x: 200, y: 0 }, Number.NaN)],
      })
    ).toThrow()
  })
})

describe("calligraphy presets", () => {
  test("ship broad nib, italic and pointed tilt nib", () => {
    for (const name of ["Broad nib", "Italic", "Pointed tilt nib"])
      expect(preset(name).kind).toBe("calligraphy")
    expect(preset("Pointed tilt nib").params.fixation).toBeLessThan(1)
  })

  test("reject a nib angle out of range", () => {
    expect(() => nib({ nibAngle: 200 })).toThrow()
    expect(() => nib({ fixation: 2 })).toThrow()
  })
})

test("SVG export draws calligraphy strokes as filled outline paths", () => {
  const doc = createBlankDocument({ width: 220, height: 100 })
  const id = addVectorLayer(doc)
  const node = findNode(doc, id)
  if (node.kind !== "vector") throw new Error("Expected vector")
  for (const name of ["Broad nib", "Italic", "Pointed tilt nib"]) {
    node.scene = { objects: [stroke(preset(name), { x: 200, y: 80 }, 1)] }
    const { svg } = serializeSvg(doc, { raster: "omit" })
    expect(svg).toMatch(
      /<path d="M[^"]+" fill="#000000" fill-opacity="1" fill-rule="nonzero" stroke="none"\/>/
    )
    expect(svg).toContain("data-vector-brush=")
  }
})
