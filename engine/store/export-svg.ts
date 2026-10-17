import { brushArtOutlines, vectorBrushObject } from "../doc/vector-brush"
import type { PaintDocument, LayerNode } from "../doc/document"
import type { BezierPath } from "../doc/vector-path"
import { tessellateObject, type Mesh } from "../geom/tessellate"
import type { VectorObject } from "../doc/vector-scene"
import {
  boundsOverlap,
  cutMesh,
  meshRegion,
  regionPath,
  unionRegions,
  type Region,
} from "../geom/erase-cut"

export type SvgExportOptions = {
  raster: "embed" | "omit"
  /**
   * Whether a brush stroke keeps its brush, as JSON, beside the paths it
   * draws. Nothing draws from it, and a pattern brush's art repeats on every
   * stroke, so a plain export leaves it out.
   */
  brushData?: boolean
}
export type SvgExportResult = { svg: string; warnings: string[] }
/** Prepared PNG data URLs, keyed by layer or mask id. Encoding stays outside the pure serializer. */
export type SvgImages = ReadonlyMap<string, string>
const escape = (value: string) =>
  value
    .replace(
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800-\udfff\ufffe\uffff]/gu,
      "\ufffd"
    )
    .replace(
      /[&<>"']/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&apos;",
        })[char]!
    )

/** Keep authored anchors and handles as native SVG cubic segments. */
export function pathData(path: BezierPath): string {
  const first = path.nodes[0]
  const commands = [`M${first.x} ${first.y}`]
  const segments = path.closed ? path.nodes.length : path.nodes.length - 1
  for (let i = 0; i < segments; i++) {
    const a = path.nodes[i],
      b = path.nodes[(i + 1) % path.nodes.length]
    if (a.out || b.in) {
      const out = a.out ?? a,
        incoming = b.in ?? b
      commands.push(
        `C${out.x} ${out.y} ${incoming.x} ${incoming.y} ${b.x} ${b.y}`
      )
    } else commands.push(`L${b.x} ${b.y}`)
  }
  if (path.closed) commands.push("Z")
  return commands.join(" ")
}

/** One nonzero fill unions the renderer's stroke triangles without repeatedly
 * applying opacity where bands overlap. Give every triangle the same winding. */
function strokeOutline(mesh: Mesh): string {
  const commands: string[] = [],
    v = mesh.vertices
  for (let i = 0; i < v.length; i += 6) {
    const [ax, ay, bx, by, cx, cy] = v.subarray(i, i + 6)
    const cross = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
    if (!cross) continue
    commands.push(
      cross > 0
        ? `M${ax} ${ay} L${bx} ${by} L${cx} ${cy} Z`
        : `M${ax} ${ay} L${cx} ${cy} L${bx} ${by} Z`
    )
  }
  return commands.join(" ")
}

function shape(object: VectorObject, brushData = false): string {
  const painted = vectorBrushObject(object)
  const { style, transform } = painted
  const g = painted.geometry
  const fill = g.kind === "path" && !g.closed ? null : style.fill
  const stroke = style.stroke
  const attrs = `transform="matrix(${transform.join(" ")})" fill="${escape(fill?.color ?? "none")}"${fill ? ` fill-opacity="${fill.opacity}" fill-rule="${fill.rule}"` : ""} stroke="${escape(stroke?.color ?? "none")}"${stroke ? ` stroke-opacity="${stroke.opacity}" stroke-width="${stroke.width}" stroke-linecap="${stroke.cap}" stroke-linejoin="${stroke.join}"` : ""}`
  switch (g.kind) {
    case "rect":
      return `<rect x="${g.x}" y="${g.y}" width="${g.width}" height="${g.height}" ${attrs}/>`
    case "ellipse":
      return `<ellipse cx="${g.cx}" cy="${g.cy}" rx="${g.rx}" ry="${g.ry}" ${attrs}/>`
    case "path": {
      const d = pathData(g)
      const outlines = brushArtOutlines(painted)
      if (outlines && stroke) {
        // The art is expanded to plain filled paths; asked for, the spine and
        // brush ride along for anything that wants to re-flow it.
        const filled = fill
          ? `<path d="${d}" transform="matrix(${transform.join(" ")})" fill="${escape(fill.color)}" fill-opacity="${fill.opacity}" fill-rule="${fill.rule}"/>`
          : ""
        const art = outlines
          .map(
            (o) =>
              `<path d="M${o.map((p) => `${p.x} ${p.y}`).join(" L")} Z" fill="${escape(stroke.color)}" fill-opacity="${stroke.opacity}" fill-rule="nonzero" stroke="none"/>`
          )
          .join("")
        const drawn = `<g transform="matrix(${transform.join(" ")})">${art}</g>${filled}`
        return brushData
          ? `<g data-vector-brush="${escape(JSON.stringify(painted.brush))}" data-spine="${escape(d)}">${drawn}</g>`
          : drawn
      }
      if (g.nodes[0].width === undefined) return `<path d="${d}" ${attrs}/>`
      // Pressure widths are already placed by the same mesh the canvas draws,
      // so the outline must not receive the object's transform a second time.
      const mesh = tessellateObject(object).stroke
      const filled = fill
        ? `<path d="${d}" transform="matrix(${transform.join(" ")})" fill="${escape(fill.color)}" fill-opacity="${fill.opacity}" fill-rule="${fill.rule}"/>`
        : ""
      const outline =
        mesh && stroke
          ? `<path d="${strokeOutline(mesh)}" fill="${escape(stroke.color)}" fill-opacity="${stroke.opacity}" fill-rule="nonzero" stroke="none"/>`
          : ""
      return brushData && object.brush
        ? `<g data-vector-brush="${escape(JSON.stringify({ ...object.brush, spine: object.geometry }))}">${filled}${outline}</g>`
        : `${filled}${outline}`
    }
    case "polygon":
      return `<${g.closed ? "polygon" : "polyline"} points="${g.points.map((p) => `${p.x},${p.y}`).join(" ")}" ${attrs}/>`
  }
}

/**
 * How much finer than the canvas a cut shape's curves are flattened. A cut
 * shape is written as polygons where it was a curve, so its chords stray
 * 1/16 of a pixel, not the canvas's quarter, which a viewer's anti-aliasing
 * would show along an ellipse's edge.
 */
const CUT_DETAIL = 4

type Painted = {
  object: VectorObject
  meshes: ReturnType<typeof tessellateObject>
  /** The eraser marks drawn after this object that reach it. */
  erasers: { object: VectorObject; region: Region }[]
}

/** What an eraser's mark takes away: its fill and stroke together. */
function eraserRegion(object: VectorObject): Region {
  const { fill, stroke } = tessellateObject(object, CUT_DETAIL)
  return unionRegions(
    [fill, stroke].flatMap((mesh) => (mesh ? [meshRegion(mesh)] : []))
  )
}

/**
 * The object's fill and stroke with its erasers cut out, "" when nothing is
 * left, or null when no eraser meets it after all (only the boxes met).
 */
function cutShape(
  { object, erasers }: Painted,
  brushData: boolean
): string | null {
  const meshes = tessellateObject(object, CUT_DETAIL)
  const painted = vectorBrushObject(object)
  const regions = erasers.map((e) => e.region)
  const pieces: string[] = []
  let met = false
  for (const [mesh, paint] of [
    [meshes.fill, painted.style.fill],
    [meshes.stroke, painted.style.stroke],
  ] as const) {
    if (!mesh || !paint) continue
    const cut = cutMesh(mesh, regions)
    met ||= cut !== null
    const d = regionPath(cut ?? meshRegion(mesh))
    if (d)
      pieces.push(
        `<path d="${d}" fill="${escape(paint.color)}" fill-opacity="${paint.opacity}" fill-rule="evenodd" stroke="none"/>`
      )
  }
  if (!met) return null
  const drawn = pieces.join("")
  return brushData && drawn && object.brush
    ? `<g data-vector-brush="${escape(JSON.stringify({ ...object.brush, spine: object.geometry }))}">${drawn}</g>`
    : drawn
}

/** Whether a mark erases only partly, which only a mask can show. */
const partial = (mark: VectorObject) =>
  (mark.style.fill?.opacity ?? 1) < 1 || (mark.style.stroke?.opacity ?? 1) < 1

/** The old way, kept for a shape whose cut fails: a mask per shape, one level deep. */
function maskedShape(
  { object, erasers }: Painted,
  width: number,
  height: number,
  defs: string[],
  id: string,
  brushData: boolean
): string {
  const marks = erasers
    .map(({ object: mark }) => {
      const stroke = mark.style.stroke && {
        ...mark.style.stroke,
        color: "#000000",
      }
      const fill = mark.style.fill && { ...mark.style.fill, color: "#000000" }
      return shape({ ...mark, style: { fill, stroke } })
    })
    .join("")
  defs.push(
    `<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="#ffffff"/>${marks}</mask>`
  )
  return `<g mask="url(#${id})">${shape(object, brushData)}</g>`
}

/**
 * A scene's objects bottom first. An eraser's mark takes from everything
 * drawn before it, so each shape it reaches is written with the mark cut
 * out, and one it covers is left out. A shape no mark reaches is written
 * as it is.
 */
function sceneContent(
  objects: readonly VectorObject[],
  width: number,
  height: number,
  defs: string[],
  nextId: () => string,
  brushData: boolean,
  warn: (message: string) => void
): string {
  const drawn: Painted[] = []
  for (const object of objects) {
    const meshes = tessellateObject(object)
    if (!object.erase) {
      drawn.push({ object, meshes, erasers: [] })
      continue
    }
    const marks = [meshes.fill, meshes.stroke]
    let region: Region | null = null
    for (const below of drawn) {
      const reached = [below.meshes.fill, below.meshes.stroke].some((m) =>
        marks.some((mark) =>
          boundsOverlap(m?.bounds ?? null, mark?.bounds ?? null)
        )
      )
      if (!reached) continue
      region ??= eraserRegion(object)
      below.erasers.push({ object, region })
    }
  }
  return drawn
    .map((painted) => {
      if (!painted.erasers.length) return shape(painted.object, brushData)
      if (painted.erasers.some((e) => partial(e.object))) {
        warn("A partly transparent eraser mark is exported as a mask.")
        return maskedShape(painted, width, height, defs, nextId(), brushData)
      }
      try {
        return cutShape(painted, brushData) ?? shape(painted.object, brushData)
      } catch {
        warn(
          "An erased shape could not be cut and is exported under a mask instead."
        )
        return maskedShape(painted, width, height, defs, nextId(), brushData)
      }
    })
    .join("")
}

/** Serializes the authored tree, never the display's flattened vector cache. */
export function serializeSvg(
  doc: PaintDocument,
  options: SvgExportOptions,
  images: SvgImages = new Map()
): SvgExportResult {
  const warnings: string[] = [
    "SVG viewers blend in display colour space; blends may differ from Velura's linear-light rendering.",
  ]
  const defs: string[] = []
  let sequence = 0
  let erasures = 0
  const image = (url: string) =>
    `<image width="${doc.width}" height="${doc.height}" href="${escape(url)}"/>`
  function level(nodes: readonly LayerNode[]): string {
    let base: string | undefined
    return nodes
      .map((node) => {
        const id = `svg-layer-${++sequence}`
        if (
          /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800-\udfff\ufffe\uffff]/u.test(
            node.name
          )
        )
          warnings.push(
            `${node.name}: characters invalid in XML were replaced in the layer name.`
          )
        let content =
          node.kind === "group"
            ? level(node.children)
            : node.kind === "vector"
              ? sceneContent(
                  node.scene.objects,
                  doc.width,
                  doc.height,
                  defs,
                  () => `${id}-erase-${++erasures}`,
                  options.brushData ?? false,
                  (message) => warnings.push(`${node.name}: ${message}`)
                )
              : ""
        if (node.kind === "raster") {
          if (options.raster === "omit")
            warnings.push(`${node.name}: raster layer omitted.`)
          else {
            const url = images.get(node.id)
            if (!url) throw new Error(`Missing PNG for ${node.name}.`)
            content = image(url)
            warnings.push(
              `${node.name}: raster colours converted to sRGB; out-of-gamut colours are clipped.`
            )
          }
        }
        let mask = ""
        if (node.mask?.enabled) {
          const url = images.get(node.mask.id)
          if (!url) throw new Error(`Missing PNG mask for ${node.name}.`)
          const maskId = `${id}-mask`
          defs.push(
            `<mask id="${maskId}" maskUnits="userSpaceOnUse" x="0" y="0" width="${doc.width}" height="${doc.height}" style="mask-type:alpha">${image(url)}</mask>`
          )
          mask = ` mask="url(#${maskId})"`
        }
        const blend =
          node.blend === "colour"
            ? "color"
            : node.blend === "add" || node.blend === "subtract"
              ? "normal"
              : node.blend
        if (blend !== node.blend && node.blend !== "colour")
          warnings.push(
            `${node.name}: ${node.blend} blend approximated as normal.`
          )
        let rendered = `<g id="${id}" data-name="${escape(node.name)}" opacity="${node.opacity}"${node.visible ? "" : ' display="none"'} style="isolation:isolate;mix-blend-mode:${blend}"${mask}><title>${escape(node.name)}</title>${content}</g>`
        if (node.clip && base) {
          if (blend !== "normal")
            warnings.push(
              `${node.name}: SVG clipping may change blending with lower layers.`
            )
          const clipId = `${id}-clip`
          defs.push(
            `<mask id="${clipId}" maskUnits="userSpaceOnUse" x="0" y="0" width="${doc.width}" height="${doc.height}" style="mask-type:alpha"><use href="#${base}"/></mask>`
          )
          rendered = `<g mask="url(#${clipId})">${rendered}</g>`
        }
        if (!node.clip && node.visible && node.opacity > 0) base = id
        return rendered
      })
      .join("")
  }
  const content = level(doc.layers)
  return {
    svg: `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="${doc.width}" height="${doc.height}" viewBox="0 0 ${doc.width} ${doc.height}"><defs>${defs.join("")}</defs>${content}</svg>`,
    warnings: [...new Set(warnings)],
  }
}
