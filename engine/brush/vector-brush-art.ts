import type { PatternPiece } from "./vector-brush"
import { flattenPath, type BezierPath } from "../doc/vector-path"
import type { Point, VectorObject } from "../doc/vector-scene"

/** A hash of `seed`, `stream` and lattice index `i`, in [-1, 1]. */
export function lattice(seed: number, stream: number, i: number): number {
  let h =
    (seed ^ Math.imul(i, 0x9e3779b1) ^ Math.imul(stream + 1, 0x85ebca6b)) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d)
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b)
  h ^= h >>> 16
  return ((h >>> 0) / 0xffffffff) * 2 - 1
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
