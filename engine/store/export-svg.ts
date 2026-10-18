import { pencilShade } from "../brush/vector-brush"
import { brushArtOutlines, vectorBrushObject } from "../doc/vector-brush"
import type { PaintDocument, LayerNode } from "../doc/document"
import type { BezierPath } from "../doc/vector-path"
import { tessellateObject, type Mesh } from "../geom/tessellate"
import type { Affine } from "../doc/transform-session"
import type { VectorObject } from "../doc/vector-scene"
import { GRAIN_TEXTURE_SIZE } from "../brush/texture"
import { GRAIN_CUT } from "../shaders/grain"
import { VECTOR_PAPER_SCALE } from "../shaders/vector"
import {
  boundsOverlap,
  cutMesh,
  meshRegion,
  outlinePath,
  regionPath,
  unionRegions,
  type Region,
} from "../geom/region"

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

/**
 * A stroke's outline: the union of the triangles the canvas draws it with,
 * as its boundary and any hole it encloses where it loops, not one sliver
 * per triangle.
 */
function strokeOutline(mesh: Mesh): string {
  return regionPath(meshRegion(mesh))
}

/**
 * How many decimals brush art is written to. The art is in the object's own
 * space, under its transform, so its rounding error is multiplied by how
 * far the transform stretches it along its longest axis; enough decimals
 * keep that within 0.01 document px. Never fewer than 2.
 */
function artPlaces([a, b, c, d]: Affine): number {
  const stretch = Math.max(Math.hypot(a, b), Math.hypot(c, d))
  const places = Math.ceil(Math.log10(50 * stretch))
  return Number.isFinite(places) ? Math.max(2, places) : 2
}

/** A pencil filter's id: its grain depth and tone, each to the hundredth. */
const PENCIL_ID = "velura-pencil-"

/**
 * The filter attribute that bites a brush stroke with its paper grain and
 * lightens it by its tone, "" for neither. An eraser's mark takes away
 * solidly, as on the canvas. A filter holds one depth and one tone, so
 * those pressure varies along the stroke are written at their means.
 */
function grainAttr(object: VectorObject): string {
  const brush = object.brush
  const params = brush?.definition.params
  if (object.erase || !params) return ""
  let depth = params.grain,
    tone = 1
  const weights =
    params.grainPressure || params.pressureTone
      ? tessellateObject(object).stroke?.weights
      : undefined
  if (weights?.length) {
    const calligraphy = brush.definition.kind === "calligraphy"
    depth = tone = 0
    for (const weight of weights) {
      const shade = pencilShade(params, weight, calligraphy)
      depth += shade.depth / weights.length
      tone += shade.tone / weights.length
    }
  }
  const d = Math.round(depth * 100),
    t = Math.round(tone * 100)
  return d > 0 || t < 100 ? ` filter="url(#${PENCIL_ID}${d}-${t})"` : ""
}

/**
 * The pencil filters `content` uses, over the whole document. SVG's
 * turbulence stands in for the paper texture: about its tooth, cut as the
 * canvas cuts it with the smooth step made straight, but not the same grains.
 */
function grainFilters(content: string, width: number, height: number) {
  const used = new Set(
    content.match(new RegExp(`${PENCIL_ID}\\d+-\\d+`, "g")) ?? []
  )
  // The paper's speckle cells, in document pixels, at the scale it is read.
  const cell = (GRAIN_TEXTURE_SIZE * VECTOR_PAPER_SCALE) / 32
  return [...used].map((id) => {
    const [d, t] = id.slice(PENCIL_ID.length).split("-").map(Number)
    const depth = d / 100,
      tone = t / 100
    const cut = depth * GRAIN_CUT
    // Turbulence sits about a half, where the paper fills its range: spread
    // it, cut it at `cut` over the slope's half, then mix by depth and tone.
    const spread = 2.5
    const carve = `${2 * spread} 0 0 0 ${2 * (0.5 - spread / 2 - cut)}`
    const mix = `0 0 0 ${tone * depth} ${tone * (1 - depth)}`
    return `<filter id="${id}" filterUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}" color-interpolation-filters="linearRGB"><feTurbulence type="fractalNoise" baseFrequency="${1 / cell}" numOctaves="3" seed="0" result="tooth"/><feColorMatrix in="tooth" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 ${carve}" result="carved"/><feColorMatrix in="carved" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 ${mix}" result="kept"/><feComposite in="SourceGraphic" in2="kept" operator="in"/></filter>`
  })
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
        const places = artPlaces(transform)
        const art = outlines
          .map((o) => outlinePath(o, places))
          // A piece of art under a hundredth of a pixel rounds to nothing.
          .filter(Boolean)
          .map(
            (outline) =>
              `<path d="${outline}" fill="${escape(stroke.color)}" fill-opacity="${stroke.opacity}" fill-rule="nonzero" stroke="none"/>`
          )
          .join("")
        const drawn = `<g${grainAttr(object)}><g transform="matrix(${transform.join(" ")})">${art}</g></g>${filled}`
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
          ? `<path d="${strokeOutline(mesh)}" fill="${escape(stroke.color)}" fill-opacity="${stroke.opacity}" fill-rule="nonzero" stroke="none"${grainAttr(object)}/>`
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
  for (const [mesh, paint, filter] of [
    [meshes.fill, painted.style.fill, ""],
    [meshes.stroke, painted.style.stroke, grainAttr(object)],
  ] as const) {
    if (!mesh || !paint) continue
    const cut = cutMesh(mesh, regions)
    met ||= cut !== null
    const d = regionPath(cut ?? meshRegion(mesh))
    if (d)
      pieces.push(
        `<path d="${d}" fill="${escape(paint.color)}" fill-opacity="${paint.opacity}" fill-rule="evenodd" stroke="none"${filter}/>`
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
  const grains = grainFilters(content, doc.width, doc.height)
  if (grains.length) {
    defs.push(...grains)
    warnings.push(
      "Pencil grain is approximated with SVG turbulence at each stroke's mean pressure; its pattern differs from Velura's."
    )
  }
  return {
    svg: `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="${doc.width}" height="${doc.height}" viewBox="0 0 ${doc.width} ${doc.height}"><defs>${defs.join("")}</defs>${content}</svg>`,
    warnings: [...new Set(warnings)],
  }
}
