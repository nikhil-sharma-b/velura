import {
  BUILTIN_VECTOR_BRUSHES,
  MAX_PATTERN_LENGTH,
  MAX_PATTERN_NODES,
  MAX_PATTERN_SOURCE_NODES,
  MAX_SCATTER_SPACING,
  isArtBrushKind,
  parseArtBrush,
  parseVectorBrush,
  type ArtBrush,
  type PatternAxis,
  type PatternPiece,
  type PatternShape,
  type PatternSource,
  type VectorBrush,
} from "../brush/vector-brush"
import { lattice } from "../brush/vector-brush-art"
import type { Affine } from "./transform-session"
import {
  flattenPath,
  splitPathSegment,
  taperScale,
  type BezierPath,
  type PathNode,
} from "./vector-path"
import type {
  LineCap,
  LineJoin,
  Point,
  SceneCommand,
  VectorObject,
  VectorScene,
} from "./vector-scene"

/** The most nodes noise may subdivide a stroke into. */
const MAX_NOISE_NODES = 4000
/** A fast hand, in document pixels per millisecond, thins fully. */
const FAST = 3

/** Smooth value noise at `s` lattice cells along, in [-1, 1]. */
function noise(seed: number, stream: number, s: number): number {
  const i = Math.floor(s),
    f = s - i
  const e = f * f * (3 - 2 * f)
  return lattice(seed, stream, i) * (1 - e) + lattice(seed, stream, i + 1) * e
}

/**
 * Thins pressure as the hand speeds up, fed each sample as it is drawn.
 * Speed is eased so a single jumpy sample does not notch the line.
 */
export function createVelocityThinning(thinning: number) {
  let last: { x: number; y: number; time: number } | null = null
  let speed = 0
  return (x: number, y: number, pressure: number, time: number): number => {
    if (last && time > last.time)
      speed +=
        (Math.hypot(x - last.x, y - last.y) / (time - last.time) - speed) * 0.3
    last = { x, y, time }
    return thinning
      ? pressure * (1 - thinning * Math.min(1, speed / FAST))
      : pressure
  }
}

/**
 * A nib's width at `heading`, as a share of its broad edge: `min` along the
 * nib, all of it across. Both in radians.
 */
export function nibWidth(heading: number, nib: number, min: number): number {
  return min + (1 - min) * Math.abs(Math.sin(heading - nib))
}

/**
 * The nib's angle: `fixed`, turned towards the pen's `tilt` by as much as
 * `fixation` lets go. A nib turned half way round is the same nib, so it
 * turns the short way, within a quarter turn.
 */
export function nibAngle(
  fixed: number,
  tilt: number | undefined,
  fixation: number
): number {
  if (tilt === undefined) return fixed
  const turn = tilt - fixed
  return fixed + (1 - fixation) * (turn - Math.PI * Math.round(turn / Math.PI))
}

/**
 * The mean direction a pen leaned while drawing, fed each sample's tilt in
 * degrees. Directions half a turn apart count alike, and a sample leans in
 * as far as it tilts; a mouse, never tilting, leaves it unknown.
 */
export function createTiltDirection() {
  let x = 0,
    y = 0
  return {
    add(tiltX: number, tiltY: number) {
      const lean = Math.hypot(tiltX, tiltY)
      if (!lean) return
      const doubled = 2 * Math.atan2(tiltY, tiltX)
      x += lean * Math.cos(doubled)
      y += lean * Math.sin(doubled)
    },
    angle(): number | undefined {
      return Math.hypot(x, y) > 1e-6 ? Math.atan2(y, x) / 2 : undefined
    },
  }
}

/** The direction a path heads through `nodes[i]`, in radians. */
function heading(nodes: readonly PathNode[], i: number, closed: boolean) {
  const node = nodes[i],
    n = nodes.length
  if (node.out && (node.out.x !== node.x || node.out.y !== node.y))
    return Math.atan2(node.out.y - node.y, node.out.x - node.x)
  if (node.in && (node.in.x !== node.x || node.in.y !== node.y))
    return Math.atan2(node.y - node.in.y, node.x - node.in.x)
  const a = nodes[closed ? (i + n - 1) % n : Math.max(0, i - 1)],
    b = nodes[closed ? (i + 1) % n : Math.min(n - 1, i + 1)]
  return Math.atan2(b.y - a.y, b.x - a.x)
}

/** Each node's distance along the path, measured node to node. */
function distances(path: BezierPath): number[] {
  const lengths = [0]
  for (let i = 1; i < path.nodes.length; i++)
    lengths.push(
      lengths[i - 1] +
        Math.hypot(
          path.nodes[i].x - path.nodes[i - 1].x,
          path.nodes[i].y - path.nodes[i - 1].y
        )
    )
  return lengths
}

/** Splits each segment so no node is more than `spacing` from the next. */
function subdivide(path: BezierPath, spacing: number): BezierPath {
  const { nodes } = path
  const budget = Math.max(1, Math.floor(MAX_NOISE_NODES / nodes.length))
  // A closed path's last segment runs back round to its first node.
  for (let i = nodes.length - (path.closed ? 1 : 2); i >= 0; i--) {
    const to = nodes[(i + 1) % nodes.length]
    const pieces = Math.min(
      budget,
      Math.ceil(Math.hypot(to.x - nodes[i].x, to.y - nodes[i].y) / spacing)
    )
    for (let k = pieces; k > 1; k--)
      path = splitPathSegment(path, i + pieces - k, 1 / k)
  }
  return path
}

/** Moves a node and its handles together by `(dx, dy)`. */
function shift(node: PathNode, dx: number, dy: number): PathNode {
  const by = (p: PathNode["in"]) => p && { x: p.x + dx, y: p.y + dy }
  return {
    ...node,
    x: node.x + dx,
    y: node.y + dy,
    in: by(node.in),
    out: by(node.out),
  }
}

/**
 * The object as painted: geometry remains the editable spine, and the
 * brush's widths, noise and caps are derived from it and its seed on each
 * edit.
 */
export function vectorBrushObject(object: VectorObject): VectorObject {
  if (
    !object.brush ||
    isArtBrushKind(object.brush.definition.kind) ||
    object.geometry.kind !== "path" ||
    !object.style.stroke
  )
    return object
  const { seed, tilt } = object.brush
  const params = object.brush.definition.params
  const calligraphy = object.brush.definition.kind === "calligraphy"
  const { pressure, pressureCurve, minWidth, taper, tremor, wiggle } = params
  const full = object.style.stroke.width
  let path = object.geometry
  // Split curves before tapering, so a two-node straight line has a full-width body.
  if (taper.start || taper.end)
    for (let i = path.nodes.length - 2; i >= 0; i--)
      path = splitPathSegment(path, i, 0.5)
  const tremorCell = Math.max(4, full * 1.5),
    wiggleCell = Math.max(8, full * 4)
  if (tremor || wiggle)
    path = subdivide(path, Math.min(tremorCell, wiggleCell) / 2)
  // The nib's width turns with the path, so curves are split finely enough to show it.
  if (calligraphy) path = subdivide(path, Math.max(2, full / 2))
  const nib = nibAngle((params.nibAngle * Math.PI) / 180, tilt, params.fixation)
  // A nib's edge is its minimum; pressure only scales it.
  const floor = calligraphy ? 0 : minWidth
  const lengths = distances(path)
  const total = lengths.at(-1) ?? 0
  const nodes = path.nodes
  const shaped = (node: PathNode) => {
    if (!pressure) return full
    const width = node.width ?? full
    // The plain pressure fit, exactly as before profiles.
    if (pressureCurve === 1 && floor === 0) return width
    const p = Math.max(0, Math.min(1, width / full)) ** pressureCurve
    return full * (floor + (1 - floor) * p)
  }
  return {
    ...object,
    geometry: {
      ...path,
      nodes: nodes.map((node, i) => {
        const along = lengths[i]
        let width = shaped(node) * (total ? taperScale(along, total, taper) : 1)
        if (calligraphy)
          width *= nibWidth(heading(nodes, i, path.closed), nib, minWidth)
        if (tremor)
          width *= Math.max(0, 1 + tremor * noise(seed, 0, along / tremorCell))
        if (!wiggle || nodes.length < 2) return { ...node, width }
        const n = nodes.length
        const a = nodes[path.closed ? (i + n - 1) % n : Math.max(0, i - 1)],
          b = nodes[path.closed ? (i + 1) % n : Math.min(n - 1, i + 1)]
        const length = Math.hypot(b.x - a.x, b.y - a.y)
        if (!length) return { ...node, width }
        const offset = wiggle * full * noise(seed, 1, along / wiggleCell)
        return {
          ...shift(
            node,
            (-(b.y - a.y) / length) * offset,
            ((b.x - a.x) / length) * offset
          ),
          width,
        }
      }),
    },
    style: {
      ...object.style,
      stroke: {
        ...object.style.stroke,
        cap:
          params.caps === "style"
            ? object.style.stroke.cap
            : params.caps === "flat"
              ? "butt"
              : "round",
      },
    },
  }
}

/** Bézier circle handles: a quarter turn's handles are this share of the radius. */
const KAPPA = 0.5522847498

/** An object's outline as a closed path, placed by its transform. */
function placedOutline(object: VectorObject): BezierPath {
  const [a, b, c, d, e, f] = object.transform as Affine
  const at = (p: Point): Point => ({
    x: a * p.x + c * p.y + e,
    y: b * p.x + d * p.y + f,
  })
  const corner = (p: Point): PathNode => ({
    ...at(p),
    in: null,
    out: null,
    type: "cusp",
  })
  const g = object.geometry
  switch (g.kind) {
    case "path":
      return {
        kind: "path",
        closed: true,
        nodes: g.nodes.map((n) => ({
          ...at(n),
          in: n.in && at(n.in),
          out: n.out && at(n.out),
          type: n.type,
        })),
      }
    case "polygon":
      return { kind: "path", closed: true, nodes: g.points.map(corner) }
    case "rect":
      return {
        kind: "path",
        closed: true,
        nodes: [
          { x: g.x, y: g.y },
          { x: g.x + g.width, y: g.y },
          { x: g.x + g.width, y: g.y + g.height },
          { x: g.x, y: g.y + g.height },
        ].map(corner),
      }
    case "ellipse": {
      const { cx, cy, rx, ry } = g
      const kx = rx * KAPPA,
        ky = ry * KAPPA
      return {
        kind: "path",
        closed: true,
        nodes: [
          [cx + rx, cy, 0, ky],
          [cx, cy + ry, -kx, 0],
          [cx - rx, cy, 0, -ky],
          [cx, cy - ry, kx, 0],
        ].map(([x, y, hx, hy]) => ({
          ...at({ x, y }),
          in: at({ x: x - hx, y: y - hy }),
          out: at({ x: x + hx, y: y + hy }),
          type: "smooth",
        })),
      }
    }
  }
}

/** Miters reach at most this many half widths out; past it they bevel, as in SVG. */
const MITER_LIMIT = 4
/** Segments in a half turn of a stroke's round cap or join. */
const CAP_SEGMENTS = 8
/** Turns gentler than this join at their miter, whatever the join. */
const GENTLE = Math.cos(Math.PI / 32)

const cusp = (p: Point): PathNode => ({
  x: p.x,
  y: p.y,
  in: null,
  out: null,
  type: "cusp",
})

/** Points `half` from `at` swept the short way from direction `from` to `to`. */
function arc(at: Point, from: Point, to: Point, half: number): Point[] {
  const a = Math.atan2(from.y, from.x)
  let turn = Math.atan2(to.y, to.x) - a
  turn -= 2 * Math.PI * Math.round(turn / (2 * Math.PI))
  const steps = Math.max(
    1,
    Math.ceil((CAP_SEGMENTS * Math.abs(turn)) / Math.PI)
  )
  return Array.from({ length: steps + 1 }, (_, k) => {
    const t = a + (turn * k) / steps
    return { x: at.x + Math.cos(t) * half, y: at.y + Math.sin(t) * half }
  })
}

/**
 * A stroke `width` wide along `points` as closed outlines: one for an open
 * line, capped by `cap`, and for a closed one an outer and an inner ring
 * wound against each other, so a nonzero fill leaves the middle empty.
 * Corners take `join` on their outer side, as SVG draws them.
 */
function strokeOutlines(
  points: readonly Point[],
  closed: boolean,
  width: number,
  cap: LineCap,
  join: LineJoin
): Point[][] {
  const pts = points.filter(
    (p, i) =>
      i === 0 || Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y) > 1e-9
  )
  if (closed && pts.length > 2) {
    const a = pts[0],
      b = pts.at(-1)!
    if (Math.hypot(a.x - b.x, a.y - b.y) <= 1e-9) pts.pop()
  }
  const n = pts.length
  if (n < 2) return []
  const half = width / 2
  const normal = (i: number) => {
    const a = pts[i],
      b = pts[(i + 1) % n]
    const d = Math.hypot(b.x - a.x, b.y - a.y)
    return { x: -(b.y - a.y) / d, y: (b.x - a.x) / d }
  }
  const segments = closed ? n : n - 1
  const normals = Array.from({ length: segments }, (_, i) => normal(i))
  // Each vertex pushed out to `side`: gentle turns and the inner side meet
  // at the miter, the outer side of a sharper one takes the join.
  const offset = (side: number): Point[] =>
    pts.flatMap((p, i) => {
      const before = closed ? normals[(i - 1 + n) % n] : normals[i - 1]
      const after = closed ? normals[i % n] : normals[i]
      const at = (u: Point, k = 1): Point => ({
        x: p.x + side * u.x * half * k,
        y: p.y + side * u.y * half * k,
      })
      if (!before || !after) return [at((before ?? after)!)]
      const m = { x: before.x + after.x, y: before.y + after.y }
      const len = Math.hypot(m.x, m.y)
      const cos = len > 1e-9 ? (m.x * after.x + m.y * after.y) / len : 0
      const u = len > 1e-9 ? { x: m.x / len, y: m.y / len } : after
      const k = 1 / Math.max(cos, 1e-9)
      if (cos >= GENTLE) return [at(u, k)]
      // The inner side doubles back through the vertex, so a short segment
      // is not overshot; a nonzero fill covers the loop.
      const turn = before.x * after.y - before.y * after.x
      if (side * turn > 0) return [at(before), p, at(after)]
      if (join === "miter" && k <= MITER_LIMIT) return [at(u, k)]
      if (join === "round")
        return arc(
          p,
          { x: side * before.x, y: side * before.y },
          { x: side * after.x, y: side * after.y },
          half
        )
      return [at(before), at(after)]
    })
  const left = offset(1),
    right = offset(-1)
  const back = [...right].reverse()
  if (closed) return [left, back]
  const end = (at: Point, dir: Point, from: Point): Point[] => {
    if (cap === "butt") return []
    if (cap === "square")
      return [
        { x: from.x + dir.x * half, y: from.y + dir.y * half },
        {
          x: 2 * at.x - from.x + dir.x * half,
          y: 2 * at.y - from.y + dir.y * half,
        },
      ]
    const start = Math.atan2(from.y - at.y, from.x - at.x)
    const turn = Math.atan2(dir.y, dir.x) - start
    const sweep =
      turn - 2 * Math.PI * Math.round(turn / (2 * Math.PI)) > 0
        ? Math.PI
        : -Math.PI
    return Array.from({ length: CAP_SEGMENTS - 1 }, (_, k) => {
      const t = start + (sweep * (k + 1)) / CAP_SEGMENTS
      return { x: at.x + Math.cos(t) * half, y: at.y + Math.sin(t) * half }
    })
  }
  const along = (i: number, j: number) => {
    const d = Math.hypot(pts[j].x - pts[i].x, pts[j].y - pts[i].y)
    return { x: (pts[j].x - pts[i].x) / d, y: (pts[j].y - pts[i].y) / d }
  }
  return [
    [
      ...left,
      ...end(pts[n - 1], along(n - 2, n - 1), left.at(-1)!),
      ...back,
      ...end(pts[0], along(1, 0), right[0]),
    ],
  ]
}

/**
 * The art an object paints, placed by its transform: its fill's outline,
 * and its stroke as outlines of its own, so a stroke-only or open path keeps
 * its line. An object with neither fill nor stroke counts as filled.
 */
function objectArt(object: VectorObject): BezierPath[] {
  const outline = placedOutline(object)
  const { fill, stroke } = object.style
  const open = object.geometry.kind === "path" && !object.geometry.closed
  const art: BezierPath[] = []
  if (fill || (!stroke && !open)) art.push(outline)
  if (stroke && stroke.width > 0) {
    const [a, b, c, d] = object.transform as Affine
    const width = stroke.width * Math.sqrt(Math.abs(a * d - b * c))
    const flat = flattenPath({ ...outline, closed: !open }, 1)
    for (const ring of strokeOutlines(
      flat.points,
      !open,
      width,
      stroke.cap,
      stroke.join
    ))
      if (ring.length >= 3)
        art.push({ kind: "path", closed: true, nodes: ring.map(cusp) })
  }
  return art
}

export type { PatternAxis, PatternSource }
export { brushArtOutlines } from "../brush/vector-brush"
export { patternOutlines, scatterOutlines } from "../brush/vector-brush-art"

/** Each object's art, and its open path should it be drawn as the axis. */
function shapesOf(objects: readonly VectorObject[]): PatternShape[] {
  return objects
    .filter((object) => !object.erase)
    .map((object) => {
      const g = object.geometry
      return {
        id: object.id,
        paths: objectArt(object).filter((p) => p.nodes.length >= 2),
        line:
          g.kind === "path" && !g.closed && g.nodes.length >= 2
            ? { ...placedOutline(object), closed: false }
            : null,
      }
    })
}

/** A drawn axis bent further than this, in pixels, off its chord bends the art. */
const BENT = 0.5
/** Most pieces one edge of art is cut into to bend round a drawn axis. */
const BEND_PIECES = 32

/**
 * Maps document points onto a drawn axis: x the distance along it, y the
 * signed distance off it, and the axis's length. Art off either end runs on
 * straight off it. Null when the axis is straight enough to use its chord.
 */
function bentFrame(
  line: BezierPath
): { frame: (p: Point) => Point; length: number } | null {
  const pts = flattenPath(line, 4).points.filter(
    (p, i, all) =>
      i === 0 || Math.hypot(p.x - all[i - 1].x, p.y - all[i - 1].y) > 1e-9
  )
  const a = pts[0],
    b = pts.at(-1)!
  const chord = Math.hypot(b.x - a.x, b.y - a.y)
  const off = (p: Point) =>
    Math.abs((p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x)) / chord
  if (pts.length < 3 || (chord > 1e-6 && pts.every((p) => off(p) <= BENT)))
    return null
  const lengths = [0]
  const dirs = pts.slice(1).map((p, i) => {
    const d = Math.hypot(p.x - pts[i].x, p.y - pts[i].y)
    lengths.push(lengths[i] + d)
    return { x: (p.x - pts[i].x) / d, y: (p.y - pts[i].y) / d }
  })
  const last = dirs.length - 1
  const frame = (p: Point): Point => {
    let best = { d: Infinity, x: 0, y: 0 }
    dirs.forEach((dir, j) => {
      const from = pts[j]
      const span = lengths[j + 1] - lengths[j]
      const raw = (p.x - from.x) * dir.x + (p.y - from.y) * dir.y
      const off = (t: number) => ({
        x: p.x - from.x - dir.x * t,
        y: p.y - from.y - dir.y * t,
      })
      // The nearest segment is judged clamped to each, so a far bend's
      // extension never wins; only then does art past the axis's ends run
      // on straight off them.
      const t = Math.min(span, Math.max(0, raw))
      const near = off(t)
      const d = Math.hypot(near.x, near.y)
      if (d >= best.d) return
      const clamped = raw < 0 ? -1 : raw > span ? 1 : 0
      const past = (clamped < 0 && j === 0) || (clamped > 0 && j === last)
      const v = past ? off(raw) : near
      // At a vertex the side is judged against both segments' heading.
      const other = clamped && !past ? dirs[j + clamped] : dir
      const side = Math.sign((dir.x + other.x) * v.y - (dir.y + other.y) * v.x)
      best = {
        d,
        x: lengths[j] + (past ? raw : t),
        y: side * Math.hypot(v.x, v.y),
      }
    })
    return { x: best.x, y: best.y }
  }
  return { frame, length: lengths.at(-1)! }
}

/** `path` as straight edges no longer than `step`, ready to bend. */
function densify(path: BezierPath, step: number): BezierPath {
  const pts = flattenPath(path, 4).points
  const nodes: PathNode[] = []
  const count = path.closed ? pts.length : pts.length - 1
  for (let i = 0; i < count; i++) {
    const a = pts[i],
      b = pts[(i + 1) % pts.length]
    const pieces = Math.min(
      BEND_PIECES,
      Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step))
    )
    for (let k = 0; k < pieces; k++)
      nodes.push(
        cusp({
          x: a.x + ((b.x - a.x) * k) / pieces,
          y: a.y + ((b.y - a.y) * k) / pieces,
        })
      )
  }
  if (!path.closed) nodes.push(cusp(pts.at(-1)!))
  return { kind: "path", closed: path.closed, nodes }
}

/**
 * `shapes`' art in pieces, each laid on the axis from its own start, all
 * scaled so the whole selection's height across the axis is one stroke
 * width. Pieces `roleOf` names no shapes for are left out.
 */
function selectionArt<R extends string>(
  shapes: readonly PatternShape[],
  what: string,
  roleOf: (id: string) => R,
  axis: PatternAxis = "horizontal"
): Map<R, PatternPiece> {
  let frame: (p: Point) => Point
  let drawn: string | null = null
  let bend: ((path: BezierPath) => BezierPath) | null = null
  if (axis === "horizontal") frame = (p) => p
  else if (axis === "vertical") frame = (p) => ({ x: p.y, y: -p.x })
  else {
    drawn = axis.drawn
    const line = shapes.find((s) => s.id === axis.drawn)?.line
    if (!line)
      throw new Error(
        `Draw the ${what} brush's axis as an open path, and select it with the art.`
      )
    const a = line.nodes[0],
      b = line.nodes.at(-1)!
    const d = Math.hypot(b.x - a.x, b.y - a.y)
    const bent = bentFrame(line)
    if (bent) {
      frame = bent.frame
      // Edges cut finely enough to bend, coarser should that pass the
      // node limit.
      const art = shapes
        .filter((s) => s.id !== axis.drawn)
        .flatMap((s) => s.paths)
      let step = bent.length / 64
      const nodes = () =>
        art.reduce((sum, p) => sum + densify(p, step).nodes.length, 0)
      while (step < bent.length && nodes() > MAX_PATTERN_NODES) step *= 2
      bend = (path) => densify(path, step)
    } else {
      if (!(d > 1e-6))
        throw new Error(`A ${what} brush's axis needs some length.`)
      const u = { x: (b.x - a.x) / d, y: (b.y - a.y) / d }
      frame = (p) => ({
        x: (p.x - a.x) * u.x + (p.y - a.y) * u.y,
        y: -(p.x - a.x) * u.y + (p.y - a.y) * u.x,
      })
    }
  }
  const groups = new Map<R, BezierPath[]>()
  for (const shape of shapes) {
    if (shape.id === drawn || !shape.paths.length) continue
    const paths = shape.paths.map((p): BezierPath => {
      const path = bend ? bend(p) : p
      return {
        ...path,
        nodes: path.nodes.map((n) => ({
          ...frame(n),
          in: n.in && frame(n.in),
          out: n.out && frame(n.out),
          type: n.type,
        })),
      }
    })
    const role = roleOf(shape.id)
    groups.set(role, [...(groups.get(role) ?? []), ...paths])
  }
  const all = [...groups.values()].flat()
  if (!all.length)
    throw new Error(`Select the shapes to make a ${what} brush from.`)
  if (all.reduce((sum, p) => sum + p.nodes.length, 0) > MAX_PATTERN_NODES)
    throw new Error(
      `A ${what} brush's art may have at most ${MAX_PATTERN_NODES} nodes.`
    )
  const extent = (paths: readonly BezierPath[]) => {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity
    for (const path of paths)
      for (const p of flattenPath(path).points) {
        minX = Math.min(minX, p.x)
        minY = Math.min(minY, p.y)
        maxX = Math.max(maxX, p.x)
        maxY = Math.max(maxY, p.y)
      }
    return { minX, minY, maxX, maxY }
  }
  const whole = extent(all)
  // A drawn axis is the art's middle; otherwise the middle of its bounds.
  const middle = drawn ? 0 : (whole.minY + whole.maxY) / 2
  const height = drawn
    ? 2 * Math.max(Math.abs(whole.minY), Math.abs(whole.maxY))
    : whole.maxY - whole.minY
  if (!(height > 1e-6))
    throw new Error(`A ${what} brush's art needs some height.`)
  const pieces = new Map<R, PatternPiece>()
  for (const [role, paths] of groups) {
    const { minX, maxX } = extent(paths)
    if ((maxX - minX) / height > MAX_PATTERN_LENGTH)
      throw new Error(
        `A ${what} brush's art may be at most ${MAX_PATTERN_LENGTH} times as long as it is tall.`
      )
    const unit = (p: Point): Point => ({
      x: (p.x - minX) / height,
      y: (p.y - middle) / height,
    })
    pieces.set(role, {
      length: Math.max(0.01, (maxX - minX) / height),
      paths: paths.map((p) => ({
        ...p,
        nodes: p.nodes.map((n) => ({
          ...unit(n),
          in: n.in && unit(n.in),
          out: n.out && unit(n.out),
          type: n.type,
        })),
      })),
    })
  }
  return pieces
}

const solidParams = () =>
  BUILTIN_VECTOR_BRUSHES.find((b) => b.id === "vector:solid")!.params

/** A stretched pattern brush made of `shapes` as `made` assigns them. */
function patternFromShapes(
  shapes: readonly PatternShape[],
  made: PatternSource
): ArtBrush<"pattern"> {
  const pieces = selectionArt(
    shapes,
    "pattern",
    (id) =>
      made.start?.includes(id)
        ? "start"
        : made.end?.includes(id)
          ? "end"
          : "tile",
    made.axis
  )
  const tile = pieces.get("tile")
  if (!tile)
    throw new Error(
      "A pattern brush needs some art between its caps for the tile."
    )
  // The kept art is held to the limit a saved brush is read back with.
  const kept = shapes
    .flatMap((s) => [...s.paths, ...(s.line ? [s.line] : [])])
    .reduce((sum, p) => sum + p.nodes.length, 0)
  if (kept > MAX_PATTERN_SOURCE_NODES)
    throw new Error(
      `A pattern brush's source art may have at most ${MAX_PATTERN_SOURCE_NODES} nodes.`
    )
  return parseArtBrush("pattern", {
    id: "pattern",
    name: "Pattern brush",
    kind: "pattern",
    params: solidParams(),
    pattern: {
      mode: "stretch",
      corners: "bend",
      tile,
      start: pieces.get("start") ?? null,
      end: pieces.get("end") ?? null,
      source: { shapes, made },
    },
  })
}

/**
 * A pattern brush made of `objects`, stretched once along the stroke: those
 * `source` names as caps drawn at the ends, the rest the tile between. It
 * keeps the objects' art, so `remakePatternBrush` can reassign them later.
 */
export function makePatternBrush(
  objects: readonly VectorObject[],
  source: PatternSource = {}
): ArtBrush<"pattern"> {
  return patternFromShapes(shapesOf(objects), source)
}

/**
 * `brush` with its kept source art reassigned to caps and axis by `source`,
 * keeping everything else about it; throws when it kept none.
 */
export function remakePatternBrush(
  brush: ArtBrush<"pattern">,
  source: PatternSource
): ArtBrush<"pattern"> {
  const kept = brush.pattern.source
  if (!kept)
    throw new Error(
      "This pattern brush keeps no source art, so its caps and axis are fixed."
    )
  const made = patternFromShapes(kept.shapes, source).pattern
  return {
    ...brush,
    pattern: {
      ...made,
      mode: brush.pattern.mode,
      corners: brush.pattern.corners,
    },
  }
}

/**
 * A scatter brush made of `objects`, a stroke width tall, upright and
 * evenly spaced until its jitters are turned up.
 */
export function makeScatterBrush(
  objects: readonly VectorObject[]
): ArtBrush<"scatter"> {
  const art = selectionArt(shapesOf(objects), "scatter", () => "art").get(
    "art"
  )!
  return parseArtBrush("scatter", {
    id: "scatter",
    name: "Scatter brush",
    kind: "scatter",
    params: solidParams(),
    scatter: {
      art,
      spacing: Math.min(MAX_SCATTER_SPACING, Math.max(1, art.length * 1.25)),
      size: 1,
      sizeJitter: 0,
      rotationJitter: 0,
      offsetJitter: 0,
      align: false,
    },
  })
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
      patch: {
        brush: {
          definition,
          seed: o.brush?.seed ?? 0,
          ...(o.brush?.tilt === undefined ? {} : { tilt: o.brush.tilt }),
        },
      },
    }))
}
