import { expect, test } from "bun:test"
import { createTiledMask } from "../../engine/doc/tiled-mask"
import { serializeSvg } from "../../engine/store/export-svg"
import {
  createBlankDocument,
  addVectorLayer,
  findNode,
} from "../../engine/doc/document"

test("SVG preserves named layers and vector geometry without raster caches", () => {
  const doc = createBlankDocument({ width: 40, height: 20 })
  const id = addVectorLayer(doc)
  const node = findNode(doc, id)
  if (node.kind !== "vector") throw new Error("Expected vector")
  node.name = 'Ink & "shape"'
  node.opacity = 0.5
  node.scene = {
    objects: [
      {
        id: "rect",
        geometry: { kind: "rect", x: 2, y: 3, width: 10, height: 8 },
        transform: [1, 0, 0, 1, 4, 5],
        style: {
          fill: { color: "#ff0000", opacity: 1, rule: "evenodd" },
          stroke: null,
        },
      },
    ],
  }
  const result = serializeSvg(doc, { raster: "omit" })
  expect(result.svg).toContain('viewBox="0 0 40 20"')
  expect(result.svg).toContain("Ink &amp; &quot;shape&quot;")
  expect(result.svg).toContain('<rect x="2" y="3" width="10" height="8"')
  expect(result.svg).toContain('transform="matrix(1 0 0 1 4 5)"')
  expect(result.svg).toContain('opacity="0.5"')
  expect(result.svg).not.toContain("<image")
  expect(result.warnings).toContain("Layer 1: raster layer omitted.")
})

test("SVG carries masks, clipping chains, blend modes and hidden groups", () => {
  const doc = createBlankDocument({ width: 40, height: 20 })
  const bottom = doc.layers[0]
  bottom.mask = { id: "mask", enabled: true, surface: createTiledMask(doc) }
  const top = {
    ...bottom,
    id: "top",
    name: "Top",
    mask: undefined,
    clip: true,
    blend: "colour" as const,
  }
  const next = { ...top, id: "next", blend: "subtract" as const }
  doc.layers = [
    {
      id: "group",
      name: "Group <1>",
      kind: "group",
      children: [bottom, top, next],
      visible: false,
      opacity: 0.7,
      blend: "multiply",
      clip: false,
    },
  ]
  const result = serializeSvg(
    doc,
    { raster: "embed" },
    new Map([
      [bottom.id, "data:image/png;base64,AA=="],
      [top.id, "data:image/png;base64,AA=="],
      [next.id, "data:image/png;base64,AA=="],
      ["mask", "data:image/png;base64,AA=="],
    ])
  )
  expect(result.svg).toContain('style="mask-type:alpha"')
  expect(result.svg.match(/<use href="#svg-layer-2"/g)).toHaveLength(2)
  expect(result.svg).toContain("mix-blend-mode:color")
  expect(result.svg).toContain('display="none"')
  expect(result.svg).toContain("Group &lt;1&gt;")
  expect(result.warnings).toContain(
    "Top: raster colours converted to sRGB; out-of-gamut colours are clipped."
  )
  expect(result.warnings).toContain(
    "Top: SVG clipping may change blending with lower layers."
  )
  expect(result.warnings).toContain(
    "Top: subtract blend approximated as normal."
  )
})

test("SVG serializes ellipse and open polygon styles and ignores disabled masks", () => {
  const doc = createBlankDocument({ width: 40, height: 20 })
  const id = addVectorLayer(doc)
  const node = findNode(doc, id)
  if (node.kind !== "vector") throw new Error("Expected vector")
  node.mask = { id: "disabled", enabled: false, surface: createTiledMask(doc) }
  const style = {
    fill: null,
    stroke: {
      color: "#123456",
      opacity: 0.4,
      width: 3,
      cap: "round" as const,
      join: "bevel" as const,
    },
  }
  node.scene = {
    objects: [
      {
        id: "ellipse",
        geometry: { kind: "ellipse", cx: 10, cy: 11, rx: 2, ry: 4 },
        transform: [1, 0, 0, 1, 0, 0],
        style,
      },
      {
        id: "line",
        geometry: {
          kind: "polygon",
          closed: false,
          points: [
            { x: 1, y: 2 },
            { x: 3, y: 4 },
          ],
        },
        transform: [1, 0, 0, 1, 0, 0],
        style,
      },
    ],
  }
  const result = serializeSvg(doc, { raster: "omit" })
  expect(result.svg).toContain('<ellipse cx="10" cy="11" rx="2" ry="4"')
  expect(result.svg).toContain('<polyline points="1,2 3,4"')
  expect(result.svg).toContain('fill="none"')
  expect(result.svg).toContain(
    'stroke-opacity="0.4" stroke-width="3" stroke-linecap="round" stroke-linejoin="bevel"'
  )
  expect(result.svg).not.toContain("<mask")
})

test("SVG replaces invalid XML characters in names and warns the artist", () => {
  const doc = createBlankDocument({ width: 2, height: 2 })
  doc.layers[0].name = "Ink\u0001"
  const result = serializeSvg(doc, { raster: "omit" })
  expect(result.svg).toContain("Ink\ufffd")
  expect(result.svg).not.toContain("\u0001")
  expect(
    result.warnings.some((warning) => warning.includes("invalid in XML"))
  ).toBe(true)
})

test("SVG preserves cubic handles and closing segments, but does not fill open paths", () => {
  const doc = createBlankDocument({ width: 80, height: 60 })
  const node = findNode(doc, addVectorLayer(doc))
  if (node.kind !== "vector") throw new Error("Expected vector")
  const geometry = {
    kind: "path" as const,
    closed: false,
    nodes: [
      {
        x: 10,
        y: 20,
        in: { x: 5, y: 30 },
        out: { x: 15, y: 0 },
        smooth: false,
      },
      {
        x: 40,
        y: 20,
        in: { x: 35, y: 0 },
        out: { x: 45, y: 30 },
        smooth: false,
      },
    ],
  }
  const object = {
    id: "open",
    geometry,
    transform: [1, 0, 0, 1, 3, 4] as const,
    style: {
      fill: { color: "#ff0000", opacity: 0.5, rule: "evenodd" as const },
      stroke: null,
    },
  }
  node.scene = {
    objects: [
      object,
      { ...object, id: "closed", geometry: { ...geometry, closed: true } },
    ],
  }
  const { svg } = serializeSvg(doc, { raster: "omit" })
  expect(svg).toContain(
    'd="M10 20 C15 0 35 0 40 20" transform="matrix(1 0 0 1 3 4)" fill="none"'
  )
  expect(svg).toContain('d="M10 20 C15 0 35 0 40 20 C45 30 5 30 10 20 Z"')
  expect(svg).toContain('fill-opacity="0.5" fill-rule="evenodd"')
})
