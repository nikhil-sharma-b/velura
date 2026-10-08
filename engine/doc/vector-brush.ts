import {
  BUILTIN_VECTOR_BRUSHES,
  MAX_PATTERN_LENGTH,
  MAX_PATTERN_NODES,
  MAX_SCATTER_SPACING,
  parseVectorBrush,
  type PatternPiece,
  type VectorBrush,
} from "../brush/vector-brush"
import type { Affine } from "./transform-session"
import {
  flattenPath,
  splitPathSegment,
  taperScale,
  type BezierPath,
  type PathNode,
} from "./vector-path"
import type {
  Point,
  SceneCommand,
  VectorObject,
  VectorScene,
} from "./vector-scene"

/** The most nodes noise may subdivide a stroke into. */
const MAX_NOISE_NODES = 4000
/** A fast hand, in document pixels per millisecond, thins fully. */
const FAST = 3

/** A hash of `seed`, `stream` and lattice index `i`, in [-1, 1]. */
function lattice(seed: number, stream: number, i: number): number {
  let h =
    (seed ^ Math.imul(i, 0x9e3779b1) ^ Math.imul(stream + 1, 0x85ebca6b)) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d)
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b)
  h ^= h >>> 16
  return ((h >>> 0) / 0xffffffff) * 2 - 1
}

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
    object.brush.definition.kind === "pattern" ||
    object.brush.definition.kind === "scatter" ||
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

/** The most tiles one stroke repeats; past it they stretch to fit. */
const MAX_TILES = 2000
/** Turns sharper than this begin a split-corner pattern's tiles afresh. */
const SPLIT_TURN = Math.PI / 6

/** A run of the spine as a polyline, with its widths and distances along. */
type Run = { points: Point[]; widths: number[]; lengths: number[] }

/** The spine flattened, and cut at its sharp turns when `split`. */
function spineRuns(
  path: BezierPath,
  full: number,
  pressure: boolean,
  split: boolean
): Run[] {
  const flat = flattenPath(path, 1)
  const points: Point[] = [],
    widths: number[] = []
  const count = flat.points.length + (path.closed ? 1 : 0)
  for (let i = 0; i < count; i++) {
    const p = flat.points[i % flat.points.length]
    const last = points.at(-1)
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < 1e-6) continue
    points.push(p)
    widths.push(
      pressure && flat.widths ? flat.widths[i % flat.points.length] : full
    )
  }
  const runs: Run[] = []
  let run: Run = { points: [], widths: [], lengths: [] }
  points.forEach((p, i) => {
    const prev = run.points.at(-1)
    run.points.push(p)
    run.widths.push(widths[i])
    run.lengths.push(
      prev ? run.lengths.at(-1)! + Math.hypot(p.x - prev.x, p.y - prev.y) : 0
    )
    const next = points[i + 1]
    if (!split || !prev || !next) return
    const turn =
      Math.atan2(next.y - p.y, next.x - p.x) -
      Math.atan2(p.y - prev.y, p.x - prev.x)
    // The turn the short way round, in [0, π].
    if (
      Math.abs(turn - 2 * Math.PI * Math.round(turn / (2 * Math.PI))) <=
      SPLIT_TURN
    )
      return
    runs.push(run)
    run = { points: [p], widths: [widths[i]], lengths: [0] }
  })
  if (run.points.length > 1) runs.push(run)
  return runs
}

/**
 * Where art `across` stroke widths off the spine, `s` along a run, lies.
 * The normal turns through each vertex over a stroke width or so, so the
 * art bends round a corner rather than tearing at it.
 */
function runSampler({ points, widths, lengths }: Run, full: number) {
  const n = points.length
  const dirs = points.slice(1).map((p, i) => {
    const length = lengths[i + 1] - lengths[i]
    return { x: (p.x - points[i].x) / length, y: (p.y - points[i].y) / length }
  })
  const reach = points.map((_, i) =>
    i === 0 || i === n - 1
      ? 0
      : Math.min(
          full,
          (lengths[i] - lengths[i - 1]) / 2,
          (lengths[i + 1] - lengths[i]) / 2
        )
  )
  return (s: number, across: number): Point => {
    let lo = 0,
      hi = n - 2
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (lengths[mid] <= s) lo = mid
      else hi = mid - 1
    }
    const j = lo
    const from = s - lengths[j],
      to = lengths[j + 1] - s
    const t = from / (lengths[j + 1] - lengths[j])
    let { x: dx, y: dy } = dirs[j]
    if (j > 0 && from < reach[j]) {
      const k = 0.5 * (1 - from / reach[j])
      dx += k * (dirs[j - 1].x - dirs[j].x)
      dy += k * (dirs[j - 1].y - dirs[j].y)
    }
    if (j + 2 < n && to < reach[j + 1]) {
      const k = 0.5 * (1 - to / reach[j + 1])
      dx += k * (dirs[j + 1].x - dirs[j].x)
      dy += k * (dirs[j + 1].y - dirs[j].y)
    }
    const d = Math.hypot(dx, dy) || 1
    const off = across * (widths[j] + (widths[j + 1] - widths[j]) * t)
    return {
      x: points[j].x + (points[j + 1].x - points[j].x) * t - (dy / d) * off,
      y: points[j].y + (points[j + 1].y - points[j].y) * t + (dx / d) * off,
    }
  }
}

/** A piece's outlines as polylines in its own units, flattened once a stroke. */
function pieceOutlines(piece: PatternPiece, full: number): Point[][] {
  return piece.paths.map((path) => flattenPath(path, full).points)
}

/**
 * A pattern brush's art bent along the stroke's spine: closed outlines in
 * the object's coordinates, start cap, tiles, then end cap. The art is
 * filled in the stroke's colour, nonzero, so tiles that overlap at a bend
 * stay solid.
 */
export function patternOutlines(object: VectorObject): Point[][] {
  const art = object.brush?.definition.pattern
  const { geometry, style } = object
  if (!art || geometry.kind !== "path" || !style.stroke) return []
  const full = style.stroke.width
  const runs = spineRuns(
    geometry,
    full,
    object.brush!.definition.params.pressure,
    art.corners === "split"
  )
  const shapes = new Map<PatternPiece, Point[][]>()
  const shape = (piece: PatternPiece) => {
    let found = shapes.get(piece)
    if (!found) shapes.set(piece, (found = pieceOutlines(piece, full)))
    return found
  }
  // Edges are cut finely enough along the spine to bend with it.
  const step = Math.max(1, full / 2)
  const out: Point[][] = []
  runs.forEach((run, r) => {
    const sample = runSampler(run, full)
    const place = (piece: PatternPiece, from: number, scale: number) => {
      for (const outline of shape(piece)) {
        const placed: Point[] = []
        outline.forEach((a, i) => {
          const b = outline[(i + 1) % outline.length]
          const pieces = Math.min(
            64,
            Math.max(1, Math.ceil((Math.abs(b.x - a.x) * scale) / step))
          )
          for (let k = 0; k < pieces; k++) {
            const t = k / pieces
            placed.push(
              sample(
                from + (a.x + (b.x - a.x) * t) * scale,
                a.y + (b.y - a.y) * t
              )
            )
          }
        })
        out.push(placed)
      }
    }
    const total = run.lengths.at(-1)!
    const start = r === 0 ? art.start : null,
      end = r === runs.length - 1 ? art.end : null
    let head = start ? start.length * full : 0,
      tail = end ? end.length * full : 0
    if (head + tail > total) {
      const k = total / (head + tail)
      head *= k
      tail *= k
    }
    const body = total - head - tail
    if (start && head > 0) place(start, 0, head / start.length)
    if (body > 1e-9) {
      const tile = art.tile
      const n =
        art.mode === "stretch"
          ? 1
          : Math.min(
              MAX_TILES,
              Math.max(1, Math.round(body / (tile.length * full)))
            )
      for (let i = 0; i < n; i++)
        place(tile, head + (i * body) / n, body / n / tile.length)
    }
    if (end && tail > 0) place(end, total - tail, tail / end.length)
  })
  return out
}

/** The most copies one scatter stroke drops; past it the rest are left off. */
const MAX_SCATTER_COPIES = 4000

/**
 * A scatter brush's copies dropped along the stroke's spine: closed
 * outlines in the object's coordinates, filled in the stroke's colour.
 * Copy `i` sits `i` spacings from the start and takes its jitter from the
 * seed and `i` alone, so editing the spine moves copies but never reshuffles
 * them.
 */
export function scatterOutlines(object: VectorObject): Point[][] {
  const scatter = object.brush?.definition.scatter
  const { geometry, style } = object
  if (!scatter || geometry.kind !== "path" || !style.stroke) return []
  const full = style.stroke.width
  const { seed } = object.brush!
  const runs = spineRuns(
    geometry,
    full,
    object.brush!.definition.params.pressure,
    false
  )
  // Flattened once, about the art's middle, finely enough for its largest copy.
  const most = scatter.size * (1 + scatter.sizeJitter) * full
  const shape = scatter.art.paths.map((path) =>
    flattenPath(path, most).points.map((p) => ({
      x: p.x - scatter.art.length / 2,
      y: p.y,
    }))
  )
  const gap = scatter.spacing * full
  const out: Point[][] = []
  let i = 0
  for (const { points, widths, lengths } of runs) {
    const total = lengths.at(-1)!
    let j = 0
    for (let s = 0; s <= total && i < MAX_SCATTER_COPIES; s += gap, i++) {
      while (j < points.length - 2 && lengths[j + 1] <= s) j++
      const a = points[j],
        b = points[j + 1]
      const span = lengths[j + 1] - lengths[j]
      const t = (s - lengths[j]) / span
      const dx = (b.x - a.x) / span,
        dy = (b.y - a.y) / span
      const width = widths[j] + (widths[j + 1] - widths[j]) * t
      const size =
        scatter.size * width * (1 + scatter.sizeJitter * lattice(seed, 2, i))
      const angle =
        (scatter.align ? Math.atan2(dy, dx) : 0) +
        scatter.rotationJitter * Math.PI * lattice(seed, 3, i)
      const off = scatter.offsetJitter * full * lattice(seed, 4, i)
      const cx = a.x + (b.x - a.x) * t - dy * off,
        cy = a.y + (b.y - a.y) * t + dx * off
      const cos = Math.cos(angle) * size,
        sin = Math.sin(angle) * size
      for (const outline of shape)
        out.push(
          outline.map((p) => ({
            x: cx + p.x * cos - p.y * sin,
            y: cy + p.x * sin + p.y * cos,
          }))
        )
    }
  }
  return out
}

/**
 * A brush's art as filled outlines in the object's coordinates, for the
 * kinds that draw art in place of a stroke; null for the rest.
 */
export function brushArtOutlines(object: VectorObject): Point[][] | null {
  if (!object.style.stroke) return null
  switch (object.brush?.definition.kind) {
    case "pattern":
      return patternOutlines(object)
    case "scatter":
      return scatterOutlines(object)
    default:
      return null
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

/**
 * `objects`' outlines laid on a horizontal axis through the middle of their
 * bounds, from its left edge, scaled so their height is one stroke width.
 */
function selectionArt(
  objects: readonly VectorObject[],
  what: string
): PatternPiece {
  const paths = objects
    .filter((o) => !o.erase)
    .map(placedOutline)
    .filter((p) => p.nodes.length >= 2)
  if (!paths.length)
    throw new Error(`Select the shapes to make a ${what} brush from.`)
  if (paths.reduce((sum, p) => sum + p.nodes.length, 0) > MAX_PATTERN_NODES)
    throw new Error(
      `A ${what} brush's art may have at most ${MAX_PATTERN_NODES} nodes.`
    )
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
  const height = maxY - minY
  if (!(height > 1e-6))
    throw new Error(`A ${what} brush's art needs some height.`)
  if ((maxX - minX) / height > MAX_PATTERN_LENGTH)
    throw new Error(
      `A ${what} brush's art may be at most ${MAX_PATTERN_LENGTH} times as long as it is tall.`
    )
  const middle = minY + height / 2
  const unit = (p: Point): Point => ({
    x: (p.x - minX) / height,
    y: (p.y - middle) / height,
  })
  return {
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
  }
}

const solidParams = () =>
  BUILTIN_VECTOR_BRUSHES.find((b) => b.id === "vector:solid")!.params

/** A pattern brush made of `objects`, stretched once along the stroke. */
export function makePatternBrush(
  objects: readonly VectorObject[]
): VectorBrush {
  return parseVectorBrush({
    id: "pattern",
    name: "Pattern brush",
    kind: "pattern",
    params: solidParams(),
    pattern: {
      mode: "stretch",
      corners: "bend",
      tile: selectionArt(objects, "pattern"),
      start: null,
      end: null,
    },
  })
}

/**
 * A scatter brush made of `objects`, a stroke width tall, upright and
 * evenly spaced until its jitters are turned up.
 */
export function makeScatterBrush(
  objects: readonly VectorObject[]
): VectorBrush {
  const art = selectionArt(objects, "scatter")
  return parseVectorBrush({
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
