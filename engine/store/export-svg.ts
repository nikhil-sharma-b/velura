import { brushArtOutlines, vectorBrushObject } from "../doc/vector-brush"
import type { PaintDocument, LayerNode } from "../doc/document"
import type { BezierPath } from "../doc/vector-path"
import { tessellateObject, type Mesh } from "../geom/tessellate"
import type { VectorObject } from "../doc/vector-scene"

export type SvgExportOptions = { raster: "embed" | "omit" }
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

function shape(object: VectorObject): string {
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
        // The art is expanded to plain filled paths; the spine and brush ride
        // along for anything that wants to re-flow it.
        const filled = fill
          ? `<path d="${d}" transform="matrix(${transform.join(" ")})" fill="${escape(fill.color)}" fill-opacity="${fill.opacity}" fill-rule="${fill.rule}"/>`
          : ""
        const art = outlines
          .map(
            (o) =>
              `<path d="M${o.map((p) => `${p.x} ${p.y}`).join(" L")} Z" fill="${escape(stroke.color)}" fill-opacity="${stroke.opacity}" fill-rule="nonzero" stroke="none"/>`
          )
          .join("")
        return `<g data-vector-brush="${escape(JSON.stringify(painted.brush))}" data-spine="${escape(d)}"><g transform="matrix(${transform.join(" ")})">${art}</g>${filled}</g>`
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
      return `<g${object.brush ? ` data-vector-brush="${escape(JSON.stringify({ ...object.brush, spine: object.geometry }))}"` : ""}>${filled}${outline}</g>`
    }
    case "polygon":
      return `<${g.closed ? "polygon" : "polyline"} points="${g.points.map((p) => `${p.x},${p.y}`).join(" ")}" ${attrs}/>`
  }
}

/**
 * A scene's objects bottom first. An eraser's mark takes from everything
 * drawn before it, so what is below one goes under a mask it cuts black.
 */
function sceneContent(
  objects: readonly VectorObject[],
  width: number,
  height: number,
  defs: string[],
  nextId: () => string
): string {
  let content = ""
  for (const object of objects) {
    if (!object.erase) {
      content += shape(object)
      continue
    }
    const stroke = object.style.stroke && {
      ...object.style.stroke,
      color: "#000000",
    }
    const fill = object.style.fill && { ...object.style.fill, color: "#000000" }
    const id = nextId()
    defs.push(
      `<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="#ffffff"/>${shape({ ...object, style: { fill, stroke } })}</mask>`
    )
    content = `<g mask="url(#${id})">${content}</g>`
  }
  return content
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
                  () => `${id}-erase-${++erasures}`
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
