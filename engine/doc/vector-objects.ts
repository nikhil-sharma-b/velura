/** Object selection follows the same painted meshes the renderer uses. */
import { covers, tessellateObject } from "../geom/tessellate"
import { applyAffine, type Affine } from "./transform-session"
import type { Extent } from "./snap"
import type {
  Point,
  SceneCommand,
  VectorObject,
  VectorScene,
} from "./vector-scene"

export function objectBounds(object: VectorObject): Extent | null {
  const meshes = tessellateObject(object)
  const bounds = [meshes.fill?.bounds, meshes.stroke?.bounds].filter(
    (b) => b != null
  )
  if (!bounds.length) return null
  const x = Math.min(...bounds.map((b) => b.minX))
  const y = Math.min(...bounds.map((b) => b.minY))
  return {
    x,
    y,
    width: Math.max(...bounds.map((b) => b.maxX)) - x,
    height: Math.max(...bounds.map((b) => b.maxY)) - y,
  }
}

export function objectsBounds(
  scene: VectorScene,
  ids: readonly string[]
): Extent | null {
  const bounds = scene.objects
    .filter((o) => ids.includes(o.id))
    .map(objectBounds)
    .filter((b) => b != null)
  if (!bounds.length) return null
  const x = Math.min(...bounds.map((b) => b.x)),
    y = Math.min(...bounds.map((b) => b.y))
  return {
    x,
    y,
    width: Math.max(...bounds.map((b) => b.x + b.width)) - x,
    height: Math.max(...bounds.map((b) => b.y + b.height)) - y,
  }
}

export function selectObjects(
  scene: VectorScene,
  region: Point | Extent
): string[] {
  if (!("width" in region)) {
    for (const object of [...scene.objects].reverse()) {
      const { fill, stroke } = tessellateObject(object)
      if (
        (fill && covers(fill, region.x, region.y)) ||
        (stroke && covers(stroke, region.x, region.y))
      )
        return [object.id]
    }
    return []
  }
  return scene.objects
    .filter((object) => {
      const box = objectBounds(object)
      return (
        box &&
        box.x >= region.x &&
        box.y >= region.y &&
        box.x + box.width <= region.x + region.width &&
        box.y + box.height <= region.y + region.height
      )
    })
    .map((o) => o.id)
}

/** Compose a document-space change with each object's existing placement. */
export function transformObjects(
  scene: VectorScene,
  ids: readonly string[],
  matrix: Affine
): SceneCommand[] {
  return scene.objects
    .filter((o) => ids.includes(o.id))
    .map((object) => {
      const [a, b, c, d, e, f] = object.transform
      const origin = applyAffine(matrix, { x: e, y: f })
      const [u, v, w, z] = matrix
      return {
        type: "update",
        id: object.id,
        patch: {
          transform: [
            u * a + w * b,
            v * a + z * b,
            u * c + w * d,
            v * c + z * d,
            origin.x,
            origin.y,
          ],
        },
      }
    })
}
