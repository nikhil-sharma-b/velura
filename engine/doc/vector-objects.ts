/** Object selection follows the same painted meshes the renderer uses. */
import { covers, tessellateObject } from "../geom/tessellate"
import { applyAffine, type Affine } from "./transform-session"
import type { Extent } from "./snap"
import type {
  LineCap,
  LineJoin,
  Point,
  SceneCommand,
  VectorObject,
  VectorScene,
} from "./vector-scene"

/**
 * A shape's fill and outline as the shape options show them (19): whether
 * each is on, and with what. A null colour is the current colour.
 */
export type ShapeStyle = Readonly<{
  fill: boolean
  stroke: boolean
  /** The outline's width in document pixels. */
  strokeWidth: number
  strokeCap: LineCap
  strokeJoin: LineJoin
  fillColor: string | null
  strokeColor: string | null
  /**
   * How much of what is beneath the shape it covers, in [0, 1]: one setting,
   * written to the fill and the outline together.
   */
  opacity: number
}>

/**
 * The style the selected objects have, as the shape options show it, or
 * null with none selected. Of several, the lowest one's speaks for them; a
 * part an object lacks — the outline of a fill-only shape — keeps
 * `fallback`'s settings for when it is turned on. The opacity is the fill's,
 * or the outline's of an object with no fill: the options set both as one.
 */
export function selectionStyle(
  scene: VectorScene,
  ids: readonly string[],
  fallback: ShapeStyle
): ShapeStyle | null {
  const object = scene.objects.find((o) => ids.includes(o.id))
  if (!object) return null
  const { fill, stroke } = object.style
  return {
    fill: fill !== null,
    stroke: stroke !== null,
    strokeWidth: stroke?.width ?? fallback.strokeWidth,
    strokeCap: stroke?.cap ?? fallback.strokeCap,
    strokeJoin: stroke?.join ?? fallback.strokeJoin,
    fillColor: fill?.color ?? null,
    strokeColor: stroke?.color ?? null,
    opacity: fill?.opacity ?? stroke?.opacity ?? fallback.opacity,
  }
}

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

/**
 * Whether a point lies inside a convex outline, whichever way round its
 * corners run: a selection band dragged on a turned view is such a shape.
 */
export function insideConvex(
  outline: readonly Point[],
  x: number,
  y: number
): boolean {
  let sign = 0
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i],
      b = outline[(i + 1) % outline.length]
    const cross = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x)
    if (Math.abs(cross) < 1e-9) continue
    if (sign && Math.sign(cross) !== sign) return false
    sign = Math.sign(cross)
  }
  return true
}

export function selectObjects(
  scene: VectorScene,
  region: Point | Extent | readonly Point[]
): string[] {
  // An eraser's marks are part of what is drawn, never something picked.
  scene = { objects: scene.objects.filter((o) => !o.erase) }
  // A band on a turned view: the objects drawn wholly inside it.
  if (Array.isArray(region))
    return scene.objects
      .filter((object) => {
        const { fill, stroke } = tessellateObject(object)
        const meshes = [fill, stroke].filter((m) => m?.bounds)
        return (
          meshes.length > 0 &&
          meshes.every((mesh) => {
            const v = mesh!.vertices
            for (let i = 0; i < v.length; i += 2)
              if (!insideConvex(region, v[i], v[i + 1])) return false
            return true
          })
        )
      })
      .map((o) => o.id)
  const extent = region as Point | Extent
  if (!("width" in extent)) {
    const at = extent
    for (const object of [...scene.objects].reverse()) {
      const { fill, stroke } = tessellateObject(object)
      if (
        (fill && covers(fill, at.x, at.y)) ||
        (stroke && covers(stroke, at.x, at.y))
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
        box.x >= extent.x &&
        box.y >= extent.y &&
        box.x + box.width <= extent.x + extent.width &&
        box.y + box.height <= extent.y + extent.height
      )
    })
    .map((o) => o.id)
}

/**
 * What an eraser drawn across a vector layer takes (19): every object its tip
 * touches, whole, as the vector apps' object erasers do. The objects are
 * meshed once for the stroke, and each step from the last point to the next
 * is walked in half-tip steps, so a quick swipe cannot jump a thin line.
 */
export function objectEraser(scene: VectorScene, radius: number) {
  const meshes = scene.objects
    .filter((object) => !object.erase)
    .map((object) => ({
      id: object.id,
      box: objectBounds(object),
      ...tessellateObject(object),
    }))
  const r = Math.max(0.5, radius)
  // The tip is tested at its centre and on two rings, which leaves no gap a
  // shape could pass through unseen.
  const tip: Point[] = [{ x: 0, y: 0 }]
  for (const scale of [0.5, 1])
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2
      tip.push({
        x: Math.cos(angle) * r * scale,
        y: Math.sin(angle) * r * scale,
      })
    }
  let last: Point | undefined
  const hit = new Set<string>()
  return {
    hit: hit as ReadonlySet<string>,
    /** Moves the tip to `to`, and answers whether it took anything new. */
    moveTo(to: Point): boolean {
      const from = last ?? to
      last = to
      const steps = Math.max(
        1,
        Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / (r / 2))
      )
      let took = false
      for (const mesh of meshes) {
        if (hit.has(mesh.id) || !mesh.box) continue
        const box = mesh.box
        for (let step = 0; step <= steps; step++) {
          const t = step / steps
          const cx = from.x + (to.x - from.x) * t
          const cy = from.y + (to.y - from.y) * t
          if (
            cx + r < box.x ||
            cy + r < box.y ||
            cx - r > box.x + box.width ||
            cy - r > box.y + box.height
          )
            continue
          if (
            tip.some(
              (p) =>
                (mesh.fill && covers(mesh.fill, cx + p.x, cy + p.y)) ||
                (mesh.stroke && covers(mesh.stroke, cx + p.x, cy + p.y))
            )
          ) {
            hit.add(mesh.id)
            took = true
            break
          }
        }
      }
      return took
    },
  }
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
