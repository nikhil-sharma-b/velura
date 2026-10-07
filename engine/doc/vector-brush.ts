import { parseVectorBrush, type VectorBrush } from "../brush/vector-brush"
import { splitPathSegment, taperScale } from "./vector-path"
import type { SceneCommand, VectorObject, VectorScene } from "./vector-scene"

/** Geometry remains the editable spine; painted widths are derived on each edit. */
export function vectorBrushGeometry(
  object: VectorObject
): VectorObject["geometry"] {
  if (!object.brush || object.geometry.kind !== "path" || !object.style.stroke)
    return object.geometry
  const { pressure, taper } = object.brush.definition.params
  let path = object.geometry
  // Split curves before tapering, so a two-node straight line has a full-width body.
  if (taper.start || taper.end) {
    for (let i = path.nodes.length - 2; i >= 0; i--) {
      path = splitPathSegment(path, i, 0.5)
    }
  }
  const lengths = [0]
  for (let i = 1; i < path.nodes.length; i++)
    lengths.push(
      lengths[i - 1] +
        Math.hypot(
          path.nodes[i].x - path.nodes[i - 1].x,
          path.nodes[i].y - path.nodes[i - 1].y
        )
    )
  const total = lengths.at(-1) ?? 0
  return {
    ...path,
    nodes: path.nodes.map((node, i) => {
      const scale = total ? taperScale(lengths[i], total, taper) : 1
      return {
        ...node,
        width:
          (pressure
            ? (node.width ?? object.style.stroke!.width)
            : object.style.stroke!.width) * scale,
      }
    }),
  }
}

export function applyVectorBrush(
  scene: VectorScene,
  ids: readonly string[],
  brush: VectorBrush
): SceneCommand[] {
  const definition = parseVectorBrush(brush)
  return scene.objects
    .filter(
      (o) =>
        ids.includes(o.id) &&
        !o.erase &&
        o.geometry.kind === "path" &&
        o.style.stroke
    )
    .map((o) => ({
      type: "update",
      id: o.id,
      patch: { brush: { definition, seed: o.brush?.seed ?? 0 } },
    }))
}
