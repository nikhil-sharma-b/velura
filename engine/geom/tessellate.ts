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

import { vectorBrushGeometry } from "../doc/vector-brush"
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

/**
 * Enough chords that none strays from an arc of `radius` by more than the
 * tolerance, `detail` times finer for a view that magnifies it.
 */
function arcSegments(radius: number, sweep: number, detail = 1): number {
  const tolerance = TOLERANCE / detail
  if (radius <= tolerance) return 1
  const step = 2 * Math.acos(1 - tolerance / radius)
  return Math.max(1, Math.ceil(Math.abs(sweep) / step))
}

/** The object's outline in its own coordinates, and whether it closes. */
function outline(
  object: VectorObject,
  detail: number
): {
  points: Point[]
  closed: boolean
  widths?: number[] | null
  corners?: number[]
} {
  const geometry = vectorBrushGeometry(object)
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
      const count = Math.max(8, arcSegments(radius, Math.PI * 2, detail))
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
      return flattenPath(
        geometry,
        Math.hypot(...object.transform.slice(0, 4)) * detail
      )
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

/**
 * A pressure stroke turning more than this (cos 30°) at a point is joined
 * with a disc there rather than a shared edge, which would pinch it.
 */
const SMOOTH_TURN_COS = Math.cos(Math.PI / 6)

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
 * With `widths`, a pressure stroke, the band's width follows the pen. A
 * join at each of the hundreds of points a curve flattens to would spike
 * mitres, so its quads instead share their edges, offset along each point's
 * mean normal; only a sharp turn, or a corner node (`corners`, indices into
 * `input`), is rounded with a disc and given the stroke's own join. Its
 * ends take the stroke's cap.
 */
export function tessellateStroke(
  input: readonly Point[],
  closed: boolean,
  stroke: Pick<VectorStroke, "width" | "cap" | "join">,
  widths?: readonly number[] | null,
  corners: readonly number[] = [],
  detail = 1,
  /**
   * Which ends are the stroke's own, capped; an end that is not joins on to
   * a piece drawn apart, and is rounded so the two meet without a seam.
   */
  ends: Readonly<{ start: boolean; end: boolean }> = { start: true, end: true }
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
    const count = arcSegments(half, sweep, detail)
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
    const capped = [
      { at: points[0], out: edge(0), sign: -1, own: ends.start },
      { at: points.at(-1)!, out: edge(segments - 1), sign: 1, own: ends.end },
    ]
    for (const { at, out, sign, own } of capped) {
      if (!own) continue
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
    // A strip whose quads share an edge at every point, offset along the
    // mean of the two chords' normals: seamless however far it is zoomed,
    // where a disc per point leaves its polygon's notches between hulls.
    // A sharp turn would pinch the strip, so there each chord keeps its
    // own normal and a disc rounds the gap, as the outline's round join.
    const sharp = (i: number) => {
      if (!closed && (i === 0 || i === points.length - 1)) return false
      if (points[i].corner) return true
      const a = edge((i - 1 + points.length) % points.length),
        b = edge(i)
      return a.x * b.x + a.y * b.y < SMOOTH_TURN_COS
    }
    const sideAt = (i: number, chord: number): Vector => {
      if (sharp(i)) return normal(edge(chord))
      const before =
        !closed && i === 0
          ? edge(0)
          : edge((i - 1 + points.length) % points.length)
      const after = !closed && i === points.length - 1 ? before : edge(i)
      const mean = { x: before.x + after.x, y: before.y + after.y }
      const length = Math.hypot(mean.x, mean.y)
      return length > 1e-9
        ? normal({ x: mean.x / length, y: mean.y / length })
        : normal(after)
    }
    points.forEach((point, i) => {
      if (sharp(i) && point.width > 0) {
        fan(point, 0, Math.PI * 2, point.width / 2)
        if (stroke.join === "miter") join(i)
      }
    })
    if (!closed)
      for (const [own, point] of [
        [ends.start, points[0]],
        [ends.end, points.at(-1)!],
      ] as const)
        if (!own && point.width > 0) fan(point, 0, Math.PI * 2, point.width / 2)
    for (let i = 0; i < segments; i++) {
      const j = (i + 1) % points.length
      const a = points[i],
        b = points[j]
      const sa = sideAt(i, i),
        sb = sideAt(j, i)
      const a1 = add(a, sa, a.width / 2)
      const a2 = add(a, sa, -a.width / 2)
      const b1 = add(b, sb, b.width / 2)
      const b2 = add(b, sb, -b.width / 2)
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

/** One mesh of the triangles of several, as one stroke is drawn in pieces. */
export function mergeMeshes(parts: readonly Mesh[], rule: CoverageRule): Mesh {
  const size = parts.reduce((sum, part) => sum + part.vertices.length, 0)
  const vertices = new Float32Array(size)
  let offset = 0,
    bounds: Bounds | null = null
  for (const part of parts) {
    vertices.set(part.vertices, offset)
    offset += part.vertices.length
    const b = part.bounds
    if (!b) continue
    bounds = bounds
      ? {
          minX: Math.min(bounds.minX, b.minX),
          minY: Math.min(bounds.minY, b.minY),
          maxX: Math.max(bounds.maxX, b.maxX),
          maxY: Math.max(bounds.maxY, b.maxY),
        }
      : { ...b }
  }
  return { vertices, rule, bounds }
}

/**
 * The meshes that draw one object, in document pixels. `detail` is how many
 * times finer than a document pixel its curves are cut, for a view zoomed
 * that far in: as Inkscape and tldraw draw a curve as a curve at any zoom,
 * the screen asks for its zoom's detail rather than enlarging the page's.
 */
export function tessellateObject(
  object: VectorObject,
  detail = 1
): {
  fill: Mesh | null
  stroke: Mesh | null
} {
  const shape = outline(object, detail)
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
          shape.corners,
          detail
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
