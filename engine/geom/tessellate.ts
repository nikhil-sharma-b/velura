/**
 * Vector geometry as triangles (19), on the CPU, for the GPU to rasterise.
 *
 * A fill is a fan of triangles from each outline's first point. Read alone
 * the fan is wrong — a concave or self-crossing outline makes triangles that
 * overlap and stick out — but counted with their signs, the triangles over a
 * point add up to exactly the outline's winding number there. The GPU does
 * that counting in a stencil buffer and then fills where the count passes
 * the fill rule, which is how any outline, holes and crossings included, is
 * drawn without triangulating it properly.
 *
 * A stroke is the outline's band of triangles — a quad per segment, plus its
 * joins and caps. Those overlap one another where segments meet, so a stroke
 * is filled wherever *any* of its triangles lands ("union"), never counted.
 *
 * `covers` asks the same question of a mesh on the CPU that the stencil asks
 * on the GPU: it is the oracle the tests check the triangles against, and how
 * a point can be hit-tested against an object without drawing it.
 */

import { flattenPath } from "../doc/vector-path"
import type {
  FillRule,
  Point,
  VectorObject,
  VectorStroke,
} from "../doc/vector-scene"
import type { Affine } from "../doc/transform-session"

/** How a mesh's triangles decide coverage: a fill rule, or any-of for strokes. */
export type CoverageRule = FillRule | "union"

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number }

export type Mesh = {
  /** Triangles in document pixels, two floats a vertex, three a triangle. */
  vertices: Float32Array
  rule: CoverageRule
  /** The box every triangle lies in; null when there are none. */
  bounds: Bounds | null
}

/**
 * How far, in document pixels, a curve's chords may stray from the curve.
 * A quarter pixel is below what antialiasing at the document's resolution
 * can show.
 */
const TOLERANCE = 0.25

function transformed(matrix: Affine, points: readonly Point[]): Point[] {
  const [a, b, c, d, e, f] = matrix
  return points.map((p) => ({
    x: a * p.x + c * p.y + e,
    y: b * p.x + d * p.y + f,
  }))
}

/** How much a matrix scales lengths, on average: what a stroke's width scales by. */
function lengthScale(matrix: Affine): number {
  const [a, b, c, d] = matrix
  return Math.sqrt(Math.abs(a * d - b * c))
}

/** Enough chords that none strays from an arc of `radius` by more than the tolerance. */
function arcSegments(radius: number, sweep: number): number {
  if (radius <= TOLERANCE) return 1
  const step = 2 * Math.acos(1 - TOLERANCE / radius)
  return Math.max(1, Math.ceil(Math.abs(sweep) / step))
}

/** The object's outline in its own coordinates, and whether it closes. */
function outline(object: VectorObject): {
  points: Point[]
  closed: boolean
  widths?: number[] | null
  corners?: number[]
} {
  const geometry = object.geometry
  switch (geometry.kind) {
    case "rect": {
      const { x, y, width, height } = geometry
      return {
        points: [
          { x, y },
          { x: x + width, y },
          { x: x + width, y: y + height },
          { x, y: y + height },
        ],
        closed: true,
      }
    }
    case "ellipse": {
      const { cx, cy, rx, ry } = geometry
      // Chords are chosen in document pixels, after the transform, so a
      // small ellipse scaled up is still smooth.
      const radius = Math.max(rx, ry) * lengthScale(object.transform)
      const count = Math.max(8, arcSegments(radius, Math.PI * 2))
      const points: Point[] = []
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2
        points.push({
          x: cx + rx * Math.cos(angle),
          y: cy + ry * Math.sin(angle),
        })
      }
      return { points, closed: true }
    }
    case "path":
      return flattenPath(geometry, Math.hypot(...object.transform.slice(0, 4)))
    case "polygon":
      return { points: [...geometry.points], closed: geometry.closed }
  }
}

/** Collects triangles and the box round them. */
function createBuilder(rule: CoverageRule) {
  const values: number[] = []
  let bounds: Bounds | null = null
  const grow = (p: Point) => {
    if (!bounds) bounds = { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y }
    else {
      bounds.minX = Math.min(bounds.minX, p.x)
      bounds.minY = Math.min(bounds.minY, p.y)
      bounds.maxX = Math.max(bounds.maxX, p.x)
      bounds.maxY = Math.max(bounds.maxY, p.y)
    }
  }
  return {
    triangle(p: Point, q: Point, r: Point) {
      values.push(p.x, p.y, q.x, q.y, r.x, r.y)
      grow(p)
      grow(q)
      grow(r)
    },
    finish(): Mesh {
      return { vertices: new Float32Array(values), rule, bounds }
    },
  }
}

/** The signed fan of each closed outline, for the stencil to count. */
export function tessellateFill(
  contours: readonly (readonly Point[])[],
  rule: FillRule
): Mesh {
  const mesh = createBuilder(rule)
  for (const contour of contours) {
    if (contour.length < 3) continue
    const origin = contour[0]
    for (let i = 1; i < contour.length - 1; i++)
      mesh.triangle(origin, contour[i], contour[i + 1])
  }
  return mesh.finish()
}

/**
 * How far a miter may reach past the line, in half-widths, before the join is
 * bevelled instead: SVG's default, so a shape exported and drawn elsewhere
 * keeps its corners.
 */
export const MITER_LIMIT = 4

type Vector = { x: number; y: number }

const add = (p: Point, v: Vector, scale = 1): Point => ({
  x: p.x + v.x * scale,
  y: p.y + v.y * scale,
})

function direction(from: Point, to: Point): Vector {
  const length = Math.hypot(to.x - from.x, to.y - from.y)
  return { x: (to.x - from.x) / length, y: (to.y - from.y) / length }
}

/** A quarter turn of `v`: the normal on its left in y-up terms. */
const normal = (v: Vector): Vector => ({ x: -v.y, y: v.x })

/** Consecutive repeats dropped, and a closing repeat of the first point. */
function distinct<T extends Point>(points: readonly T[], closed: boolean): T[] {
  const kept: T[] = []
  for (const point of points) {
    const last = kept.at(-1)
    if (!last || last.x !== point.x || last.y !== point.y) kept.push(point)
  }
  const first = kept[0]
  const last = kept.at(-1)
  if (closed && kept.length > 1 && first.x === last!.x && first.y === last!.y)
    kept.pop()
  return kept
}

/**
 * The band `stroke.width` wide centred on a run of segments, with its joins
 * and, left open, its caps.
 *
 * With `widths`, a pressure stroke, the band is the area a disc sweeps as it
 * rides the line, its size following the pen — the shape tldraw's freehand
 * outline traces. Offsetting each chord by its ends' half-widths and joining
 * every chord to the next would put a join at each of the hundreds of points
 * a hand-drawn curve flattens to, and a hand turns sharply there often
 * enough that mitres spike out and quads poke past the curve. A disc at each
 * point and the hull between each pair cannot: the stroke's own join is kept
 * for its corner nodes (`corners`, indices into `input`), its cap for its
 * ends.
 */
export function tessellateStroke(
  input: readonly Point[],
  closed: boolean,
  stroke: Pick<VectorStroke, "width" | "cap" | "join">,
  widths?: readonly number[] | null,
  corners: readonly number[] = []
): Mesh {
  const mesh = createBuilder("union")
  const corner = new Set(corners)
  const points = distinct(
    input.map((p, i) => ({
      ...p,
      width: widths?.[i] ?? stroke.width,
      corner: corner.has(i),
    })),
    closed
  )
  const segments = closed ? points.length : points.length - 1
  const edge = (i: number) =>
    direction(points[i % points.length], points[(i + 1) % points.length])

  // An arc of triangles round `center`, from `start` turning by `sweep`.
  const fan = (center: Point, start: number, sweep: number, half: number) => {
    const count = arcSegments(half, sweep)
    let previous = add(center, { x: Math.cos(start), y: Math.sin(start) }, half)
    for (let i = 1; i <= count; i++) {
      const angle = start + (sweep * i) / count
      const next = add(center, { x: Math.cos(angle), y: Math.sin(angle) }, half)
      mesh.triangle(center, previous, next)
      previous = next
    }
  }

  if (points.length < 2) {
    if (points.length && (widths || stroke.cap === "round"))
      fan(points[0], 0, Math.PI * 2, points[0].width / 2)
    return mesh.finish()
  }

  // The outer side of the join at point `i`: the band's inner side is
  // already covered by the overlapping segments; only the gap needs filling.
  const join = (i: number) => {
    const center = points[i]
    const half = center.width / 2
    const incoming = edge((i - 1 + points.length) % points.length)
    const outgoing = edge(i)
    const turn = incoming.x * outgoing.y - incoming.y * outgoing.x
    const straight = incoming.x * outgoing.x + incoming.y * outgoing.y
    if (Math.abs(turn) < 1e-9 && straight > 0) return
    // The outer side is the one the path turns away from.
    const away = turn > 0 ? -1 : 1
    const from = { x: normal(incoming).x * away, y: normal(incoming).y * away }
    const to = { x: normal(outgoing).x * away, y: normal(outgoing).y * away }
    const o0 = add(center, from, half)
    const o1 = add(center, to, half)
    if (stroke.join === "round") {
      const start = Math.atan2(from.y, from.x)
      let sweep = Math.atan2(to.y, to.x) - start
      if (sweep > Math.PI) sweep -= Math.PI * 2
      if (sweep < -Math.PI) sweep += Math.PI * 2
      fan(center, start, sweep, half)
      return
    }
    // cos of half the angle between the two outer edges.
    const bisector = { x: from.x + to.x, y: from.y + to.y }
    const length = Math.hypot(bisector.x, bisector.y)
    const cosHalf = length / 2
    if (
      stroke.join === "miter" &&
      length > 1e-9 &&
      1 / cosHalf <= MITER_LIMIT
    ) {
      const tip = add(center, bisector, half / cosHalf / length)
      mesh.triangle(center, o0, tip)
      mesh.triangle(center, tip, o1)
      return
    }
    mesh.triangle(center, o0, o1)
  }

  const caps = () => {
    if (closed || stroke.cap === "butt") return
    const ends = [
      { at: points[0], out: edge(0), sign: -1 },
      { at: points.at(-1)!, out: edge(segments - 1), sign: 1 },
    ]
    for (const { at, out, sign } of ends) {
      const half = at.width / 2
      const forward = { x: out.x * sign, y: out.y * sign }
      const side = normal(out)
      if (stroke.cap === "round") {
        // From one side, round through the end, to the other.
        const start = Math.atan2(side.y * -sign, side.x * -sign)
        fan(at, start, Math.PI, half)
        continue
      }
      const s1 = add(at, side, half)
      const s2 = add(at, side, -half)
      const s3 = add(s2, forward, half)
      const s4 = add(s1, forward, half)
      mesh.triangle(s1, s2, s3)
      mesh.triangle(s1, s3, s4)
    }
  }

  if (widths) {
    points.forEach((point, i) => {
      const end = !closed && (i === 0 || i === points.length - 1)
      if (end || point.width <= 0) return
      fan(point, 0, Math.PI * 2, point.width / 2)
      // A disc already rounds the corner; a bevel lies inside it.
      if (point.corner && stroke.join === "miter") join(i)
    })
    for (let i = 0; i < segments; i++) {
      const a = points[i]
      const b = points[(i + 1) % points.length]
      const ra = a.width / 2
      const rb = b.width / 2
      const along = Math.hypot(b.x - a.x, b.y - a.y)
      // One disc inside the other, which already covers the hull.
      if (along <= Math.abs(ra - rb)) continue
      // The outer tangents touch each disc where its radius leans back
      // along the line by the slope the width changes at.
      const u = direction(a, b)
      const side = normal(u)
      const lean = (ra - rb) / along
      const reach = Math.sqrt(1 - lean * lean)
      const touch = (sign: number): Vector => ({
        x: u.x * lean + side.x * reach * sign,
        y: u.y * lean + side.y * reach * sign,
      })
      // An open stroke's ends are cut square across the line, as the cap
      // then extends them; the hull's own ends would lean with the taper.
      const first = !closed && i === 0
      const last = !closed && i === segments - 1
      const a1 = add(a, first ? side : touch(1), ra)
      const a2 = add(a, first ? side : touch(-1), first ? -ra : ra)
      const b1 = add(b, last ? side : touch(1), rb)
      const b2 = add(b, last ? side : touch(-1), last ? -rb : rb)
      mesh.triangle(a1, b1, b2)
      mesh.triangle(a1, b2, a2)
    }
    caps()
    return mesh.finish()
  }

  for (let i = 0; i < segments; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    const side = normal(edge(i))
    const a1 = add(a, side, a.width / 2)
    const b1 = add(b, side, b.width / 2)
    const b2 = add(b, side, -b.width / 2)
    const a2 = add(a, side, -a.width / 2)
    mesh.triangle(a1, b1, b2)
    mesh.triangle(a1, b2, a2)
  }
  // A join wherever two segments meet: every point of a closed outline, the
  // inner points of an open one.
  const firstJoin = closed ? 0 : 1
  const lastJoin = closed ? points.length - 1 : points.length - 2
  for (let i = firstJoin; i <= lastJoin; i++) join(i)
  caps()
  return mesh.finish()
}

/** The meshes that draw one object, in document pixels. */
export function tessellateObject(object: VectorObject): {
  fill: Mesh | null
  stroke: Mesh | null
} {
  const shape = outline(object)
  const points = transformed(object.transform, shape.points)
  const { fill, stroke } = object.style
  return {
    fill: fill && shape.closed ? tessellateFill([points], fill.rule) : null,
    stroke: stroke
      ? tessellateStroke(
          points,
          shape.closed,
          {
            ...stroke,
            width: stroke.width * lengthScale(object.transform),
          },
          shape.widths?.map((w) => w * lengthScale(object.transform)),
          shape.corners
        )
      : null,
  }
}

/** Twice the signed area of a triangle; positive when it turns clockwise on screen. */
function cross(p: Point, q: Point, r: Point): number {
  return (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
}

/**
 * Where a point is looked at: a hair off the point asked about, by amounts no
 * outline will share, so it never lies exactly on an edge. On an edge two
 * fan triangles share, both would claim it, where the GPU's rasteriser gives
 * every sample to exactly one.
 */
const NUDGE_X = 1.234e-6
const NUDGE_Y = 2.718e-6

/**
 * How many times, counted with sign, the mesh's triangles wrap a point: the
 * winding number of the outline a fan was made from.
 */
export function windingAt(mesh: Mesh, x: number, y: number): number {
  const v = mesh.vertices
  const point = { x: x + NUDGE_X, y: y + NUDGE_Y }
  let winding = 0
  for (let i = 0; i < v.length; i += 6) {
    const p = { x: v[i], y: v[i + 1] }
    const q = { x: v[i + 2], y: v[i + 3] }
    const r = { x: v[i + 4], y: v[i + 5] }
    const area = cross(p, q, r)
    if (area === 0) continue
    const sign = Math.sign(area)
    if (
      sign * cross(p, q, point) > 0 &&
      sign * cross(q, r, point) > 0 &&
      sign * cross(r, p, point) > 0
    )
      winding += sign
  }
  return winding
}

/** Whether a point is drawn, by the mesh's own rule. */
export function covers(mesh: Mesh, x: number, y: number): boolean {
  if (mesh.rule === "union") {
    const v = mesh.vertices
    for (let i = 0; i < v.length; i += 6) {
      const single = { ...mesh, vertices: v.subarray(i, i + 6) }
      if (windingAt(single, x, y) !== 0) return true
    }
    return false
  }
  const winding = windingAt(mesh, x, y)
  return mesh.rule === "nonzero" ? winding !== 0 : winding % 2 !== 0
}
