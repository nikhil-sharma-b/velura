import type { PaintDocument, LayerNode } from "../doc/document"
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

function shape(object: VectorObject): string {
  const { geometry: g, style, transform } = object
  const fill = style.fill
  const stroke = style.stroke
  const attrs = `transform="matrix(${transform.join(" ")})" fill="${escape(fill?.color ?? "none")}"${fill ? ` fill-opacity="${fill.opacity}" fill-rule="${fill.rule}"` : ""} stroke="${escape(stroke?.color ?? "none")}"${stroke ? ` stroke-opacity="${stroke.opacity}" stroke-width="${stroke.width}" stroke-linecap="${stroke.cap}" stroke-linejoin="${stroke.join}"` : ""}`
  switch (g.kind) {
    case "rect":
      return `<rect x="${g.x}" y="${g.y}" width="${g.width}" height="${g.height}" ${attrs}/>`
    case "ellipse":
      return `<ellipse cx="${g.cx}" cy="${g.cy}" rx="${g.rx}" ry="${g.ry}" ${attrs}/>`
    case "polygon":
      return `<${g.closed ? "polygon" : "polyline"} points="${g.points.map((p) => `${p.x},${p.y}`).join(" ")}" ${attrs}/>`
  }
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
              ? node.scene.objects.map(shape).join("")
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
