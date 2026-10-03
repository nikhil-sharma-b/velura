import type { Point } from "./vector-scene"

/**
 * How a node's handles hang together, as Inkscape has it: a cusp's move
 * independently; a smooth node's stay in line, each its own length; a
 * symmetric node's stay in line and equal; an auto node's are worked out
 * from its neighbours whenever it or they move.
 */
export type NodeType = "cusp" | "smooth" | "symmetric" | "auto"

export const NODE_TYPES: readonly NodeType[] = [
  "cusp",
  "smooth",
  "symmetric",
  "auto",
]

/** The type after `type`, round again after the last (Ctrl+click). */
export const nextNodeType = (type: NodeType): NodeType =>
  NODE_TYPES[(NODE_TYPES.indexOf(type) + 1) % NODE_TYPES.length]

/** Handles are absolute positions in the object's coordinates. Width is the
 * pressure stroke's full diameter; absent widths use the object's stroke. */
export type PathNode = Readonly<
  Point & {
    in: Point | null
    out: Point | null
    type: NodeType
    width?: number
  }
>
export type BezierPath = Readonly<{
  kind: "path"
  nodes: readonly PathNode[]
  closed: boolean
}>
export type PressurePoint = Point & { pressure: number }

/** Turns sharper than this (cos 60°) are kept as corners when fitting. */
const CORNER_COS = 0.5
/** How far, in document pixels, a fitted stroke may stray from the hand. */
const FIT_TOLERANCE = 1.5
/** How far a fitted width may stray: a tenth of the brush, at least half a pixel. */
const widthTolerance = (width: number) => Math.max(0.5, width / 10)

type Sample = Point & { width: number }
type Segment = { last: number; out: Point; in: Point }

/**
 * A freehand pressure stroke as the fewest cubic Béziers that stay within
 * a pixel and a half of the hand and a tenth of the brush's width, as
 * Inkscape and Paper.js fit (Schneider, Graphics Gems 1990). Width runs
 * linearly along each segment, so pressure only adds a node where it
 * strays from that line. Sharp turns are kept as cusps.
 */
/** How much of a stroke, as a share of its length, narrows to each tip. */
export type Taper = Readonly<{ start: number; end: number }>

/** The most of a stroke one taper may take: half, so two meet at most. */
export const MAX_TAPER = 0.5

export function fitPressureStroke(
  samples: readonly PressurePoint[],
  width: number,
  taper?: Taper
): BezierPath {
  if (!samples.length)
    throw new Error("A pressure stroke needs samples and a positive width.")
  const fit = createPressureFit(width, taper)
  fit.add(samples)
  return fit.path(true)
}

/** Curves this far behind the pen, along the stroke, are left as they are. */
const FREEZE_LAG = 48
/** No curve is left alone before the stroke is this long: its start may yet hook. */
const FREEZE_AFTER = 64
/** The last curves before the pen are always refitted, frozen or not. */
const KEEP_LIVE = 2

/**
 * One fitted curve of a stroke being drawn, as the nodes that draw it: its
 * two ends and any a taper splits it at. A frozen one will not change shape
 * again, and `key` changes when its widths do.
 */
export type PressurePiece = Readonly<{
  nodes: readonly PathNode[]
  frozen: boolean
  key: string
}>

type FittedSegment = {
  from: number
  to: number
  out: Point
  in: Point
  cusp: boolean
}

/**
 * A pressure stroke fitted as it is drawn. The curves well behind the pen
 * are frozen and the rest refitted each time, leaving the frozen one's way
 * out, so a stroke being drawn neither wobbles nor changes when the pen
 * lifts: what was shown is what is kept. Settling and tapering only set
 * widths, never positions, and a taper splits curves exactly where it
 * needs more nodes, so it reshapes nothing either.
 */
export function createPressureFit(width: number, taper?: Taper) {
  if (!Number.isFinite(width) || width <= 0)
    throw new Error("A pressure stroke needs samples and a positive width.")
  const points: Sample[] = []
  const along: number[] = []
  const frozen: FittedSegment[] = []
  let tangent: Point | null = null
  let pieces: PressurePiece[] = []

  function add(samples: readonly PressurePoint[]) {
    for (const p of samples) {
      if (![p.x, p.y, p.pressure].every(Number.isFinite))
        throw new Error("Pressure samples must be finite.")
      const sample = {
        x: p.x,
        y: p.y,
        width: width * Math.max(0, Math.min(1, p.pressure)),
      }
      // A pen resting in place repeats its point; the last pressure stands.
      const previous = points.at(-1)
      if (previous && previous.x === p.x && previous.y === p.y)
        points[points.length - 1] = sample
      else {
        along.push(
          previous
            ? along.at(-1)! + Math.hypot(p.x - previous.x, p.y - previous.y)
            : 0
        )
        points.push(sample)
      }
    }
  }

  /** The curves after the frozen ones, and where the stroke starts and ends. */
  function fitTail() {
    const from = frozen.at(-1)?.to ?? 0
    const raw = points.slice(from)
    const hooks = trimHooks(raw, cornersOf(raw), from === 0)
    // Fitted to the widths once settled, so the pen's landing and lifting
    // do not split the ends into curves of their own.
    const settled = widthsOver(
      frozen.length ? 0 : from + hooks.first,
      from + hooks.last,
      false
    )
    const tail = raw.map((p, i) => ({ ...p, width: settled[from + i] }))
    const segments: FittedSegment[] = []
    const corners = hooks.corners
    for (let c = 0; c + 1 < corners.length; c++) {
      const first = corners[c],
        last = corners[c + 1]
      const leaving = c === 0 && from > 0 && tangent ? tangent : undefined
      for (const segment of fitStroke(tail, first, last, width, leaving))
        segments.push({
          from: segments.at(-1)?.to ?? from + first,
          to: from + segment.last,
          out: segment.out,
          in: segment.in,
          cusp: segment.last === last && last !== hooks.last,
        })
    }
    return { segments, start: from + hooks.first, end: from + hooks.last }
  }

  /** Each point's width once the ends have settled and tapered. */
  function widthsOver(start: number, end: number, tapered = true): number[] {
    const widths = points.map((p) => p.width)
    const total = along[end] - along[start]
    const reach = Math.min(total * SETTLE_SHARE, SETTLE_LENGTH)
    if (reach > 0) {
      let a = start
      while (a < end && along[a] - along[start] < reach) a++
      let b = end
      while (b > start && along[end] - along[b] < reach) b--
      if (a < b) {
        for (let i = start; i < a; i++) widths[i] = points[a].width
        for (let i = b + 1; i <= end; i++) widths[i] = points[b].width
      }
    }
    if (tapered && taper && total > 0)
      for (let i = start; i <= end; i++)
        widths[i] *= taperScale(along[i] - along[start], total, taper)
    return widths
  }

  /**
   * The stroke as it stands; `ended` when the pen has lifted, after which
   * nothing more is frozen.
   */
  function path(ended: boolean): BezierPath {
    if (points.length === 1) {
      const dot: PathNode = {
        x: points[0].x,
        y: points[0].y,
        width: points[0].width,
        in: null,
        out: null,
        type: "smooth",
      }
      pieces = []
      return { kind: "path", nodes: [dot, { ...dot }], closed: false }
    }
    let { segments, start, end } = fitTail()
    if (!ended && along[end] - along[start] >= FREEZE_AFTER) {
      let count = 0
      while (
        count < segments.length - KEEP_LIVE &&
        along[end] - along[segments[count].to] >= FREEZE_LAG
      )
        count++
      if (count) {
        // The first freeze settles the start: a hook trimmed off it is gone.
        if (!frozen.length && start > 0) {
          points.splice(0, start)
          const shift = along[start]
          along.splice(0, start)
          for (let i = 0; i < along.length; i++) along[i] -= shift
          for (const segment of segments) {
            segment.from -= start
            segment.to -= start
          }
          end -= start
          start = 0
        }
        const settled = segments.splice(0, count)
        frozen.push(...settled)
        const last = settled.at(-1)!
        const to = points[last.to]
        tangent = last.cusp ? null : unit(to.x - last.in.x, to.y - last.in.y)
      }
    }
    if (frozen.length) start = 0
    const widths = widthsOver(start, end)
    const all = [...frozen, ...segments]
    pieces = all.map((segment, index) => {
      const nodes = splitForTaper(
        points,
        along,
        widths,
        segment,
        index === 0 ? start : segment.from,
        start,
        end,
        taper
      )
      return {
        nodes,
        frozen: index < frozen.length,
        key: nodes.map((n) => n.width).join(","),
      }
    })
    const nodes: PathNode[] = []
    for (const piece of pieces) {
      if (nodes.length) {
        const joint = nodes.pop()!
        nodes.push(
          { ...joint, out: piece.nodes[0].out },
          ...piece.nodes.slice(1)
        )
      } else nodes.push(...piece.nodes)
    }
    return { kind: "path", nodes, closed: false }
  }

  return {
    add,
    path,
    /** The curves the last `path` was made of, for meshing piece by piece. */
    pieces: (): readonly PressurePiece[] => pieces,
  }
}

/** How much a taper narrows a point `at` this far along a stroke `total` long. */
function taperScale(at: number, total: number, taper: Taper): number {
  const clamp = (t: number) =>
    Math.max(0, Math.min(MAX_TAPER, Number.isFinite(t) ? t : 0))
  const start = clamp(taper.start) * total,
    end = clamp(taper.end) * total
  const ease = (t: number) => 1 - (1 - t) * (1 - t)
  let scale = 1
  if (start > 0 && at < start) scale *= ease(at / start)
  if (end > 0 && total - at < end) scale *= ease((total - at) / end)
  return scale
}

/**
 * One fitted curve as nodes: its ends, and, where a taper meets full
 * width on it, a node there, split off the curve exactly so its shape stays
 * as fitted.
 */
function splitForTaper(
  points: readonly Sample[],
  along: readonly number[],
  widths: readonly number[],
  segment: FittedSegment,
  from: number,
  start: number,
  end: number,
  taper?: Taper
): PathNode[] {
  const a = points[from],
    d = points[segment.to]
  const first: PathNode = {
    x: a.x,
    y: a.y,
    width: widths[from],
    in: null,
    out: segment.out,
    type: "smooth",
  }
  const last: PathNode = {
    x: d.x,
    y: d.y,
    width: widths[segment.to],
    in: segment.in,
    out: null,
    type: segment.cusp ? "cusp" : "smooth",
  }
  const s0 = along[from],
    s1 = along[segment.to]
  if (!taper || s1 <= s0) return [first, last]
  const total = along[end] - along[start]
  const cuts: number[] = []
  for (const [share, origin, sign] of [
    [taper.start, along[start], 1],
    [taper.end, along[end], -1],
  ] as const) {
    // One node where the taper meets full width: the eased width between
    // it and the tip is the curve the widths are drawn along.
    const zone = Math.max(0, Math.min(MAX_TAPER, share)) * total
    const at = origin + sign * zone
    if (zone > 0 && at > s0 && at < s1) cuts.push(at)
  }
  if (!cuts.length) return [first, last]
  cuts.sort((x, y) => x - y)
  const nodes = [first]
  let p0: Point = a,
    p1 = segment.out,
    p2 = segment.in,
    p3: Point = d,
    t0 = 0
  for (const at of cuts) {
    // Chord-length place on the curve; the split is exact wherever it falls.
    const t = (at - s0) / (s1 - s0)
    const u = (t - t0) / (1 - t0)
    const q0 = mix(p0, p1, u),
      q1 = mix(p1, p2, u),
      q2 = mix(p2, p3, u),
      r0 = mix(q0, q1, u),
      r1 = mix(q1, q2, u),
      m = mix(r0, r1, u)
    nodes[nodes.length - 1] = { ...nodes.at(-1)!, out: q0 }
    let i = from
    while (i < segment.to && along[i] < at) i++
    nodes.push({
      x: m.x,
      y: m.y,
      width: widths[i],
      in: r0,
      out: null,
      type: "smooth",
    })
    p0 = m
    p1 = r1
    p2 = q2
    t0 = t
  }
  nodes[nodes.length - 1] = { ...nodes.at(-1)!, out: p1 }
  nodes.push({ ...last, in: p2 })
  return nodes
}

/** The share of a stroke at each end whose pressure is the pen landing or lifting. */
const SETTLE_SHARE = 0.1
/** …but never more than this many document pixels of it. */
const SETTLE_LENGTH = 40

/*
 * A pen's pressure ramps up as it lands and falls as it lifts, which would
 * draw every stroke with a wedge at each end. As Inkscape's pressure pencil,
 * the first and last tenth of the stroke take the width where it settles
 * rather than their own (`widthsOver`).
 */

/** A corner nearer an end than this, along the stroke, is a pen's hook. */
const HOOK_LENGTH = 8

/**
 * Drops the hook a pen flicks as it lands or lifts: a sharp turn a few
 * pixels from an end is the hand, not the drawing, so the stroke starts or
 * ends at that corner instead. Returns where it starts and ends, and the
 * corners left between; `fromStart` false keeps the start, already drawn.
 */
function trimHooks(
  points: readonly Sample[],
  corners: number[],
  fromStart = true
): { corners: number[]; first: number; last: number } {
  const along = (from: number, to: number) => {
    let length = 0
    for (let i = from; i < to; i++)
      length += Math.hypot(
        points[i + 1].x - points[i].x,
        points[i + 1].y - points[i].y
      )
    return length
  }
  let first = 0,
    last = points.length - 1
  if (fromStart && corners.length > 2 && along(0, corners[1]) < HOOK_LENGTH)
    first = corners[1]
  const end = corners.at(-2)!
  if (
    corners.length > 2 &&
    end > first &&
    along(end, points.length - 1) < HOOK_LENGTH
  )
    last = end
  return {
    corners: corners.filter((c) => c >= first && c <= last),
    first,
    last,
  }
}

/**
 * Where the stroke turns sharply: the ends, and the corners of its outline
 * simplified to the fit tolerance that turn by more than 60°.
 */
function cornersOf(points: readonly Sample[]): number[] {
  const keep = new Set([0, points.length - 1])
  // An explicit stack avoids recursion limits on long tablet gestures.
  const pending = [[0, points.length - 1]]
  while (pending.length) {
    const [first, last] = pending.pop()!
    let largest = FIT_TOLERANCE,
      split = -1
    for (let i = first + 1; i < last; i++) {
      const error = chordDistance(points[i], points[first], points[last])
      if (error > largest) {
        largest = error
        split = i
      }
    }
    if (split >= 0) {
      keep.add(split)
      pending.push([first, split], [split, last])
    }
  }
  const outline = [...keep].sort((a, b) => a - b)
  return outline.filter((index, i) => {
    if (i === 0 || i === outline.length - 1) return true
    const before = points[outline[i - 1]],
      p = points[index],
      after = points[outline[i + 1]]
    const ax = p.x - before.x,
      ay = p.y - before.y,
      bx = after.x - p.x,
      by = after.y - p.y
    const lengths = Math.hypot(ax, ay) * Math.hypot(bx, by)
    return lengths > 0 && (ax * bx + ay * by) / lengths < CORNER_COS
  })
}

function chordDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    length = dx * dx + dy * dy
  const t = length
    ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length))
    : 0
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy)
}

const unit = (x: number, y: number): Point => {
  const length = Math.hypot(x, y) || 1
  return { x: x / length, y: y / length }
}

/**
 * The way the stroke leaves `from` toward `toward`, read an eighth of the
 * way there and at least 12 px along, so the hand's jitter cannot tip it.
 */
function tangentAt(
  points: readonly Sample[],
  from: number,
  toward: number
): Point {
  const reach = Math.max(
    12,
    Math.hypot(
      points[toward].x - points[from].x,
      points[toward].y - points[from].y
    ) / 8
  )
  const step = Math.sign(toward - from)
  let i = from + step
  while (
    i !== toward &&
    Math.hypot(points[i].x - points[from].x, points[i].y - points[from].y) <
      reach
  )
    i += step
  return unit(points[i].x - points[from].x, points[i].y - points[from].y)
}

const cubicAt = (a: Point, b: Point, c: Point, d: Point, u: number): Point => {
  const v = 1 - u
  const [k0, k1, k2, k3] = [v * v * v, 3 * u * v * v, 3 * u * u * v, u * u * u]
  return {
    x: a.x * k0 + b.x * k1 + c.x * k2 + d.x * k3,
    y: a.y * k0 + b.y * k1 + c.y * k2 + d.y * k3,
  }
}

/** The segments fitted between samples `first` and `last`, in order. */
function fitStroke(
  points: readonly Sample[],
  first: number,
  last: number,
  width: number,
  leaving?: Point
): Segment[] {
  const segments: Segment[] = []
  const widthAllowed = widthTolerance(width)
  const pending: [number, number, Point, Point][] = [
    [
      first,
      last,
      leaving ?? tangentAt(points, first, last),
      tangentAt(points, last, first),
    ],
  ]
  while (pending.length) {
    const [from, to, t1, t2] = pending.pop()!
    const a = points[from],
      d = points[to]
    const span = Math.hypot(d.x - a.x, d.y - a.y)
    const samples = points.slice(from, to + 1)
    const u = [0]
    for (let i = 1; i < samples.length; i++)
      u.push(
        u[i - 1] +
          Math.hypot(
            samples[i].x - samples[i - 1].x,
            samples[i].y - samples[i - 1].y
          )
      )
    const total = u.at(-1) || 1
    for (let i = 0; i < u.length; i++) u[i] /= total
    let b: Point = a,
      c: Point = d,
      worst = Infinity,
      split = from
    for (let pass = 0; pass < 5 && worst > 1; pass++) {
      let reach = fitReach(samples, u, a, d, t1, t2) ?? [span / 3, span / 3]
      // Handles that cross past each other along the chord would loop.
      const along = (t: Point, r: number) =>
        (t.x * (d.x - a.x) + t.y * (d.y - a.y)) * r
      if (along(t1, reach[0]) - along(t2, reach[1]) > span * span)
        reach = [span / 3, span / 3]
      b = { x: a.x + t1.x * reach[0], y: a.y + t1.y * reach[0] }
      c = { x: d.x + t2.x * reach[1], y: d.y + t2.y * reach[1] }
      worst = 0
      for (let i = 1; i < samples.length - 1; i++) {
        const p = samples[i],
          on = cubicAt(a, b, c, d, u[i])
        const error = Math.max(
          Math.hypot(p.x - on.x, p.y - on.y) / FIT_TOLERANCE,
          Math.abs(p.width - (a.width + (d.width - a.width) * u[i])) /
            widthAllowed
        )
        if (error > worst) {
          worst = error
          split = from + i
        }
      }
      // Far off, a better place along the curve will not save it.
      if (worst > 4) break
      for (let i = 1; i < u.length - 1; i++)
        u[i] = newtonPlace(a, b, c, d, samples[i], u[i])
    }
    if (worst <= 1) {
      segments.push({ last: to, out: b, in: c })
      continue
    }
    const back = tangentAt(points, split, from),
      on = tangentAt(points, split, to)
    const through = unit(back.x - on.x, back.y - on.y)
    // The right half is pushed first so the left is fitted, and kept, first.
    pending.push(
      [split, to, { x: -through.x, y: -through.y }, t2],
      [from, split, t1, through]
    )
  }
  return segments
}

const mix = (a: Point, b: Point, t: number): Point => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
})

/** De Casteljau splitting preserves the curve and interpolates pressure. */
export function splitPathSegment(
  path: BezierPath,
  index: number,
  t = 0.5
): BezierPath {
  const next = (index + 1) % path.nodes.length
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= path.nodes.length ||
    (!path.closed && next === 0) ||
    !(t > 0 && t < 1)
  )
    throw new Error("Choose a point inside an existing path segment.")
  const a = path.nodes[index],
    b = path.nodes[next]
  const p = mix(a, a.out ?? a, t),
    q = mix(a.out ?? a, b.in ?? b, t),
    r = mix(b.in ?? b, b, t)
  const s = mix(p, q, t),
    u = mix(q, r, t),
    at = mix(s, u, t)
  const nodes = [...path.nodes]
  nodes[index] = { ...a, out: p }
  nodes[next] = { ...b, in: r }
  nodes.splice(index + 1, 0, {
    ...at,
    in: s,
    out: u,
    type: "smooth",
    ...(a.width !== undefined && b.width !== undefined
      ? { width: a.width + (b.width - a.width) * t }
      : {}),
  })
  return { ...path, nodes }
}

/**
 * `path` broken at the nodes at `indices`, each into two coincident end
 * nodes, as the open paths that leaves in order along it: a closed path
 * opens at its first break, an open one parts at each. An open path's end
 * has nothing to break, so a path with no other break comes back whole.
 */
export function breakPath(
  path: BezierPath,
  indices: readonly number[]
): BezierPath[] {
  const count = path.nodes.length
  const cuts = [...new Set(indices)]
    .filter((i) =>
      path.closed ? path.nodes[i] !== undefined : i > 0 && i < count - 1
    )
    .sort((a, b) => a - b)
  if (!cuts.length) return [path]
  // A closed path read from its first break round to that node again.
  const start = path.closed ? cuts[0] : 0
  const nodes = path.closed
    ? [...path.nodes.slice(start), ...path.nodes.slice(0, start + 1)]
    : path.nodes
  const ends = path.closed
    ? [...cuts.map((c) => c - start), count]
    : [0, ...cuts, count - 1]
  // A broken end has one side left: it keeps that handle as a cusp.
  const end = (n: PathNode, side: "in" | "out"): PathNode => ({
    ...n,
    [side]: null,
    type: "cusp",
  })
  return ends.slice(1).map((last, k) => {
    const first = ends[k]
    const piece = nodes
      .slice(first, last + 1)
      .map((n, i, all) =>
        i === 0 && (path.closed || first > 0)
          ? end(n, "in")
          : i === all.length - 1 && (path.closed || last < count - 1)
            ? end(n, "out")
            : n
      )
    return { ...path, closed: false, nodes: solveAuto(piece, false) }
  })
}

/** Which end of an open path: its first node or its last. */
export type PathEnd = "start" | "end"

/** How two ends join: merged into one node, or linked by a straight segment. */
export type JoinMode = "merge" | "segment"

/** `path` run the other way, each node's handles swapping sides. */
function reversed(path: BezierPath): BezierPath {
  return {
    ...path,
    nodes: [...path.nodes]
      .reverse()
      .map((n) => ({ ...n, in: n.out, out: n.in })),
  }
}

/**
 * Open path `a`'s end `aEnd` joined to `b`'s end `bEnd`, or to its own other
 * end when `b` is null, which closes it. Merging puts one node at the ends'
 * midpoint, each end's outer handle moved with it; a segment links them
 * straight. `b` is given in `a`'s coordinates; `a` runs on into `b`.
 */
export function joinPathEnds(
  a: BezierPath,
  aEnd: PathEnd,
  b: BezierPath | null,
  bEnd: PathEnd,
  mode: JoinMode
): BezierPath {
  if (a.closed || b?.closed || (!b && aEnd === bEnd))
    throw new Error("Choose two ends of open paths.")
  if (!b) {
    if (mode === "segment") {
      // The closing segment is straight: neither end keeps a handle on it.
      const nodes = a.nodes.map((n, i) => ({
        ...n,
        ...(i === 0 ? { in: null } : {}),
        ...(i === a.nodes.length - 1 ? { out: null } : {}),
      }))
      return { ...a, closed: true, nodes: solveAuto(nodes, true) }
    }
    if (a.nodes.length < 3)
      throw new Error("A closed path needs at least two anchors.")
    const first = a.nodes[0],
      last = a.nodes[a.nodes.length - 1]
    return {
      ...a,
      closed: true,
      nodes: solveAuto([merged(last, first), ...a.nodes.slice(1, -1)], true),
    }
  }
  const head = aEnd === "end" ? a.nodes : reversed(a).nodes
  const tail = bEnd === "start" ? b.nodes : reversed(b).nodes
  const nodes =
    mode === "segment"
      ? [
          ...head.slice(0, -1),
          { ...head[head.length - 1], out: null },
          { ...tail[0], in: null },
          ...tail.slice(1),
        ]
      : [
          ...head.slice(0, -1),
          merged(head[head.length - 1], tail[0]),
          ...tail.slice(1),
        ]
  return { ...a, closed: false, nodes: solveAuto(nodes, false) }
}

/**
 * One node at the midpoint of `before`, an end that keeps its in-handle,
 * and `after`, one that keeps its out-handle, each moved with its anchor.
 */
function merged(before: PathNode, after: PathNode): PathNode {
  const mid = mix(before, after, 0.5)
  const moved = (n: PathNode, h: Point | null) =>
    h && { x: h.x + mid.x - n.x, y: h.y + mid.y - n.y }
  return {
    ...mid,
    in: moved(before, before.in),
    out: moved(after, after.out),
    type: "cusp",
    ...(before.width !== undefined && after.width !== undefined
      ? { width: (before.width + after.width) / 2 }
      : {}),
  }
}

/**
 * `path` without segments `indices` (each running from its node to the
 * next), as the open paths left in order along it: a closed path opens at
 * its first, an open one parts at each. A piece of one lone node goes.
 */
export function cutPathSegments(
  path: BezierPath,
  indices: readonly number[]
): BezierPath[] {
  const count = path.nodes.length
  const cuts = [...new Set(indices)]
    .filter((i) => i >= 0 && i < (path.closed ? count : count - 1))
    .sort((a, b) => a - b)
  if (!cuts.length) return [path]
  // A closed path read from just after its first cut round to just before.
  const start = path.closed ? cuts[0] + 1 : 0
  const nodes = [...path.nodes.slice(start), ...path.nodes.slice(0, start)]
  const ends = [
    0,
    ...cuts
      .map((c) => (c - start + count) % count)
      .filter((c) => c !== count - 1 || !path.closed)
      .map((c) => c + 1),
    count,
  ]
  return ends
    .slice(1)
    .map((last, k) => nodes.slice(ends[k], last))
    .filter((piece) => piece.length > 1)
    .map((piece) => ({
      ...path,
      closed: false,
      nodes: solveAuto(
        piece.map((n, i) => ({
          ...n,
          ...(i === 0 ? { in: null } : {}),
          ...(i === piece.length - 1 ? { out: null } : {}),
        })),
        false
      ),
    }))
}

/** A straight segment, or one with handles to bend it. */
export type SegmentShape = "line" | "curve"

/** The parts of a node that can be taken hold of and moved. */
export type NodePart = "anchor" | "in" | "out"

export type NodeEdit =
  | { type: "move"; index: number; part: NodePart; point: Point }
  | { type: "delete"; index: number }
  | { type: "retype"; index: number; nodeType: NodeType }
  /** Segment `index` runs from node `index` to the next, round if closed. */
  | { type: "segment"; index: number; shape: SegmentShape }
  | { type: "split"; index: number; t?: number }
  /** Segment `index` bent so its point at `t` passes through `point`. */
  | { type: "bend"; index: number; t: number; point: Point }

export function editPathNode(path: BezierPath, edit: NodeEdit): BezierPath {
  if (edit.type === "split") return splitPathSegment(path, edit.index, edit.t)
  if (edit.type === "bend")
    return bendPathSegment(path, edit.index, edit.t, edit.point)
  const node = path.nodes[edit.index]
  if (!node || !Number.isInteger(edit.index))
    throw new Error("Choose an existing anchor.")
  const nodes = [...path.nodes]
  if (edit.type === "delete") {
    if (nodes.length <= 2) throw new Error("A path needs at least two anchors.")
    nodes.splice(edit.index, 1)
  } else if (edit.type === "segment") {
    const next = (edit.index + 1) % nodes.length
    if (!path.closed && next === 0)
      throw new Error("Choose a segment of the path.")
    const a = nodes[edit.index],
      b = nodes[next]
    if (edit.shape === "line") {
      // An auto node would only work its handle out again: a cusp keeps
      // the segment straight.
      const cusp = (n: PathNode) => (n.type === "auto" ? "cusp" : n.type)
      nodes[edit.index] = { ...a, out: null, type: cusp(a) }
      nodes[next] = { ...b, in: null, type: cusp(b) }
    } else if (!handleOf(a, a.out) && !handleOf(b, b.in)) {
      nodes[edit.index] = { ...a, out: mix(a, b, 1 / 3) }
      nodes[next] = { ...b, in: mix(a, b, 2 / 3) }
    }
  } else if (edit.type === "retype") {
    nodes[edit.index] = retyped(path, edit.index, edit.nodeType)
  } else {
    if (![edit.point.x, edit.point.y].every(Number.isFinite))
      throw new Error("A node needs a finite position.")
    if (edit.part === "anchor") {
      const dx = edit.point.x - node.x,
        dy = edit.point.y - node.y
      const shift = (p: Point | null) => p && { x: p.x + dx, y: p.y + dy }
      nodes[edit.index] = {
        ...node,
        ...edit.point,
        in: shift(node.in),
        out: shift(node.out),
      }
    } else {
      const opposite = edit.part === "in" ? "out" : "in"
      const handle = node[opposite]
      const dx = edit.point.x - node.x,
        dy = edit.point.y - node.y,
        length = Math.hypot(dx, dy)
      // Taking hold of an auto node's handle is taking over from the solver.
      const type = node.type === "auto" ? "smooth" : node.type
      const reach =
        handle && type === "smooth"
          ? Math.hypot(handle.x - node.x, handle.y - node.y)
          : length
      nodes[edit.index] = {
        ...node,
        type,
        [edit.part]: edit.point,
        ...(type !== "cusp" && length > 0
          ? {
              [opposite]: {
                x: node.x - (dx * reach) / length,
                y: node.y - (dy * reach) / length,
              },
            }
          : {}),
      }
    }
  }
  return { ...path, nodes: solveAuto(nodes, path.closed) }
}

/**
 * `path` without the nodes at `indices`; null when fewer than two would be
 * left. Refitting, as Inkscape deletes, each run of consecutive deleted
 * nodes becomes one segment fitted to the stretch they shaped, its ends
 * keeping their directions; without, the neighbours keep their handles.
 * An open path's end run has nothing to fit to and simply goes.
 */
export function deletePathNodes(
  path: BezierPath,
  indices: readonly number[],
  { refit = true }: { refit?: boolean } = {}
): BezierPath | null {
  const gone = new Set(indices.filter((i) => path.nodes[i]))
  const kept = path.nodes.flatMap((_, i) => (gone.has(i) ? [] : [i]))
  if (kept.length < 2) return null
  const nodes = [...path.nodes]
  if (refit)
    kept.forEach((from, k) => {
      const last = k === kept.length - 1
      if (last && !path.closed) return
      const to = kept[last ? 0 : k + 1]
      if ((from + 1) % nodes.length === to) return
      const fit = fitRun(path, from, to)
      // A fitted handle is its own length: an auto node would only work it
      // out again, and a symmetric one even it with its other.
      const own = (n: PathNode): NodeType =>
        n.type === "auto" || n.type === "symmetric" ? "smooth" : n.type
      nodes[from] = { ...nodes[from], out: fit.out, type: own(nodes[from]) }
      nodes[to] = { ...nodes[to], in: fit.in, type: own(nodes[to]) }
    })
  return {
    ...path,
    nodes: solveAuto(
      kept.map((i) => nodes[i]),
      path.closed
    ),
  }
}

/** Samples taken along each segment of a run when refitting it. */
const FIT_SAMPLES = 16

/**
 * The handles of one cubic from node `from` to node `to` fitted, least
 * squares, to the segments between them, its handles along the directions
 * the curve left `from` and arrived at `to` (Schneider's fit with the
 * tangents fixed), the samples' places along it bettered by Newton's method.
 */
function fitRun(
  path: BezierPath,
  from: number,
  to: number
): { out: Point; in: Point } {
  const count = path.nodes.length
  const a = path.nodes[from],
    d = path.nodes[to]
  const samples: Point[] = []
  for (let i = from; i !== to; i = (i + 1) % count)
    for (let s = 0; s < FIT_SAMPLES; s++)
      samples.push(segmentPoint(path, i, s / FIT_SAMPLES))
  samples.push(d)
  const after = path.nodes[(from + 1) % count],
    before = path.nodes[(to - 1 + count) % count]
  const direction = (n: PathNode, ...toward: (Point | null)[]) => {
    const p = toward.find((q) => q && (q.x !== n.x || q.y !== n.y))
    if (!p) return { x: 0, y: 0 }
    const length = Math.hypot(p.x - n.x, p.y - n.y)
    return { x: (p.x - n.x) / length, y: (p.y - n.y) / length }
  }
  const t1 = direction(a, a.out, after.in, after),
    t2 = direction(d, d.in, before.out, before)
  const span = Math.hypot(d.x - a.x, d.y - a.y)

  // Chord-length places to start from.
  const u = [0]
  for (let i = 1; i < samples.length; i++)
    u.push(
      u[i - 1] +
        Math.hypot(
          samples[i].x - samples[i - 1].x,
          samples[i].y - samples[i - 1].y
        )
    )
  const total = u[u.length - 1] || 1
  for (let i = 0; i < u.length; i++) u[i] /= total

  let reach = [span / 3, span / 3]
  for (let pass = 0; pass < 5; pass++) {
    reach = fitReach(samples, u, a, d, t1, t2) ?? [span / 3, span / 3]
    const b = { x: a.x + t1.x * reach[0], y: a.y + t1.y * reach[0] },
      c = { x: d.x + t2.x * reach[1], y: d.y + t2.y * reach[1] }
    for (let i = 1; i < u.length - 1; i++)
      u[i] = newtonPlace(a, b, c, d, samples[i], u[i])
  }
  return {
    out: { x: a.x + t1.x * reach[0], y: a.y + t1.y * reach[0] },
    in: { x: d.x + t2.x * reach[1], y: d.y + t2.y * reach[1] },
  }
}

/** The two handle lengths that best fit `samples` at `u`; null if none do. */
function fitReach(
  samples: readonly Point[],
  u: readonly number[],
  a: Point,
  d: Point,
  t1: Point,
  t2: Point
): [number, number] | null {
  let c00 = 0,
    c01 = 0,
    c11 = 0,
    x0 = 0,
    x1 = 0
  samples.forEach((p, i) => {
    const t = u[i],
      v = 1 - t
    const b1 = 3 * t * v * v,
      b2 = 3 * t * t * v,
      b0 = v * v * v + b1,
      b3 = t * t * t + b2
    const a1 = { x: t1.x * b1, y: t1.y * b1 },
      a2 = { x: t2.x * b2, y: t2.y * b2 }
    const rx = p.x - (a.x * b0 + d.x * b3),
      ry = p.y - (a.y * b0 + d.y * b3)
    c00 += a1.x * a1.x + a1.y * a1.y
    c01 += a1.x * a2.x + a1.y * a2.y
    c11 += a2.x * a2.x + a2.y * a2.y
    x0 += a1.x * rx + a1.y * ry
    x1 += a2.x * rx + a2.y * ry
  })
  const det = c00 * c11 - c01 * c01
  if (Math.abs(det) < 1e-12 * Math.max(1, c00 * c11)) return null
  const r0 = (x0 * c11 - c01 * x1) / det,
    r1 = (c00 * x1 - c01 * x0) / det
  // A handle backwards, or none at all, fits nothing a node can keep.
  const span = Math.hypot(d.x - a.x, d.y - a.y)
  return r0 > 1e-6 * span && r1 > 1e-6 * span ? [r0, r1] : null
}

/** `t` moved by one Newton step toward the place on the cubic nearest `p`. */
function newtonPlace(
  a: Point,
  b: Point,
  c: Point,
  d: Point,
  p: Point,
  t: number
): number {
  const v = 1 - t
  const at = (k: "x" | "y") =>
    v * v * v * a[k] +
    3 * v * v * t * b[k] +
    3 * v * t * t * c[k] +
    t * t * t * d[k]
  const first = (k: "x" | "y") =>
    3 *
    (v * v * (b[k] - a[k]) + 2 * v * t * (c[k] - b[k]) + t * t * (d[k] - c[k]))
  const second = (k: "x" | "y") =>
    6 * (v * (c[k] - 2 * b[k] + a[k]) + t * (d[k] - 2 * c[k] + b[k]))
  const ex = at("x") - p.x,
    ey = at("y") - p.y
  const fx = first("x"),
    fy = first("y")
  const step = fx * fx + fy * fy + ex * second("x") + ey * second("y")
  if (!step) return t
  return Math.max(0, Math.min(1, t - (ex * fx + ey * fy) / step))
}

/** `path` with the nodes in `changes` put in, its auto nodes worked out again. */
export function replacePathNodes(
  path: BezierPath,
  changes: ReadonlyMap<number, PathNode>
): BezierPath {
  return {
    ...path,
    nodes: solveAuto(
      path.nodes.map((n, i) => changes.get(i) ?? n),
      path.closed
    ),
  }
}

/** The point at `t` along segment `index` of `path`, in its own coordinates. */
export const segmentPoint = (
  path: BezierPath,
  index: number,
  t: number
): Point => {
  const a = path.nodes[index],
    d = path.nodes[(index + 1) % path.nodes.length],
    b = a.out ?? a,
    c = d.in ?? d,
    u = 1 - t
  const along = (k: "x" | "y") =>
    u * u * u * a[k] +
    3 * u * u * t * b[k] +
    3 * u * t * t * c[k] +
    t * t * t * d[k]
  return { x: along("x"), y: along("y") }
}

/**
 * Segment `index` bent, as Inkscape bends it, so its point at `t` lands on
 * `point`: both handles move, the nearer one more, weighted by where along
 * the segment it was grabbed. A straight segment grows handles; each end
 * node then keeps its own type's rule for its opposite handle.
 */
export function bendPathSegment(
  path: BezierPath,
  index: number,
  t: number,
  point: Point
): BezierPath {
  const next = (index + 1) % path.nodes.length
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= path.nodes.length ||
    (!path.closed && next === 0) ||
    !(t > 0 && t < 1)
  )
    throw new Error("Choose a point inside an existing path segment.")
  if (![point.x, point.y].every(Number.isFinite))
    throw new Error("A segment needs a finite point to pass through.")
  const a = path.nodes[index],
    b = path.nodes[next],
    p1 = a.out ?? a,
    p2 = b.in ?? b,
    u = 1 - t
  const was = segmentPoint(path, index, t)
  const dx = point.x - was.x,
    dy = point.y - was.y
  // Inkscape's weighting: a grab in the first sixth moves only the near
  // handle, one in the last sixth only the far one, easing between.
  const weight =
    t <= 1 / 6
      ? 0
      : t <= 0.5
        ? ((6 * t - 1) / 2) ** 3 / 2
        : t <= 5 / 6
          ? (1 - ((6 * u - 1) / 2) ** 3) / 2 + 0.5
          : 1
  // The point at `t` moves by 3u²t of the first handle's offset and 3ut² of
  // the second's: these shares add up to exactly the pointer's offset.
  const near = (1 - weight) / (3 * t * u * u),
    far = weight / (3 * t * t * u)
  let bent = editPathNode(path, {
    type: "move",
    index,
    part: "out",
    point: { x: p1.x + dx * near, y: p1.y + dy * near },
  })
  bent = editPathNode(bent, {
    type: "move",
    index: next,
    part: "in",
    point: { x: p2.x + dx * far, y: p2.y + dy * far },
  })
  return bent
}

/** The anchors either side of node `i`; at an open end, the node itself. */
function neighbours(
  nodes: readonly PathNode[],
  i: number,
  closed: boolean
): [PathNode, PathNode] {
  const count = nodes.length
  return closed
    ? [nodes[(i - 1 + count) % count], nodes[(i + 1) % count]]
    : [nodes[Math.max(0, i - 1)], nodes[Math.min(count - 1, i + 1)]]
}

/**
 * Node `i`'s handles along its neighbours' chord, each a third of its own
 * segment, so an uneven spacing never makes a handle outrun its segment
 * and loop. An open path's end has no handle off the end.
 */
function chordHandles(
  nodes: readonly PathNode[],
  i: number,
  closed: boolean
): { in: Point | null; out: Point | null } {
  const n = nodes[i]
  const [before, after] = neighbours(nodes, i, closed)
  const tx = after.x - before.x,
    ty = after.y - before.y,
    tangent = Math.hypot(tx, ty) || 1
  const handle = (to: Point, sign: number) => {
    const length = Math.hypot(to.x - n.x, to.y - n.y)
    return {
      x: n.x + (sign * tx * length) / 3 / tangent,
      y: n.y + (sign * ty * length) / 3 / tangent,
    }
  }
  return {
    in: closed || i > 0 ? handle(before, -1) : null,
    out: closed || i < nodes.length - 1 ? handle(after, 1) : null,
  }
}

/** Every auto node's handles worked out afresh from where its neighbours are. */
function solveAuto(nodes: PathNode[], closed: boolean): PathNode[] {
  return nodes.map((n, i) =>
    n.type === "auto" ? { ...n, ...chordHandles(nodes, i, closed) } : n
  )
}

/** A handle that sits on its anchor is no handle at all. */
export const handleOf = (n: PathNode, h: Point | null) =>
  h && (h.x !== n.x || h.y !== n.y) ? h : null

/**
 * Node `index` of `path` made `type`. A cusp keeps its handles as they are;
 * a smooth or symmetric node pulls out any it lacks along the neighbour
 * chord, then lines them up, a symmetric one evening their lengths.
 */
function retyped(path: BezierPath, index: number, type: NodeType): PathNode {
  const node = path.nodes[index]
  // An auto node's handles are `solveAuto`'s to work out, as every edit ends.
  if (type === "cusp" || type === "auto") return { ...node, type }
  const pulled = chordHandles(path.nodes, index, path.closed)
  const before = handleOf(node, node.in) ?? pulled.in
  const after = handleOf(node, node.out) ?? pulled.out
  if (!before || !after) return { ...node, type, in: before, out: after }
  let dx = after.x - before.x,
    dy = after.y - before.y
  const span = Math.hypot(dx, dy)
  if (!span) return { ...node, type, in: before, out: after }
  dx /= span
  dy /= span
  let reachIn = Math.hypot(before.x - node.x, before.y - node.y),
    reachOut = Math.hypot(after.x - node.x, after.y - node.y)
  if (type === "symmetric") reachIn = reachOut = (reachIn + reachOut) / 2
  return {
    ...node,
    type,
    in: { x: node.x - dx * reachIn, y: node.y - dy * reachIn },
    out: { x: node.x + dx * reachOut, y: node.y + dy * reachOut },
  }
}

/** Adaptive subdivision in object space, with error measured after placement. */
export function flattenPath(
  path: BezierPath,
  scale = 1,
  /**
   * The widths of the nodes either side of an open path drawn as one piece
   * of a longer one, so its widths ease as the whole one's would.
   */
  around: Readonly<{ before?: number; after?: number }> = {}
): {
  points: Point[]
  widths: number[] | null
  closed: boolean
  /** Indices into `points` of the nodes that are corners, not smooth. */
  corners: number[]
} {
  const points: Point[] = [],
    corners: number[] = [],
    widths: number[] | null = path.nodes.every((n) => n.width !== undefined)
      ? []
      : null
  const count = path.closed ? path.nodes.length : path.nodes.length - 1
  const emit = (p: Point, width: number) => {
    points.push({ x: p.x, y: p.y })
    widths?.push(width)
  }
  if (!path.nodes.length)
    return { points, widths, closed: path.closed, corners }
  const slopes = widths
    ? widthSlopes(
        path.nodes.map((n) => n.width!),
        path.closed,
        around
      )
    : null
  emit(path.nodes[0], path.nodes[0].width ?? 0)
  if (path.nodes[0].type === "cusp") corners.push(0)
  let segment = 0
  // Width eases between nodes along a monotone cubic, as Inkscape's
  // PowerStroke interpolates its knots: a swell or a taper is smooth with
  // few nodes, and never overshoots the widths it passes through.
  const widthAt = (u: number) => {
    const nodes = path.nodes
    const a = nodes[segment],
      b = nodes[(segment + 1) % nodes.length]
    const w0 = a.width ?? 0,
      w1 = b.width ?? 0
    if (!slopes) return w0 + (w1 - w0) * u
    const m0 = slopes[segment],
      m1 = slopes[(segment + 1) % nodes.length]
    const u2 = u * u,
      u3 = u2 * u
    return (
      (2 * u3 - 3 * u2 + 1) * w0 +
      (u3 - 2 * u2 + u) * m0 +
      (-2 * u3 + 3 * u2) * w1 +
      (u3 - u2) * m1
    )
  }
  const walk = (
    a: Point,
    b: Point,
    c: Point,
    d: Point,
    wa: number,
    wd: number,
    depth: number
  ) => {
    // Distance to the chord segment catches collinear handles that overshoot.
    const distance = (p: Point) => {
      const dx = d.x - a.x,
        dy = d.y - a.y,
        length = dx * dx + dy * dy
      const t = length
        ? Math.max(
            0,
            Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)
          )
        : 0
      return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy)
    }
    if (depth >= 16 || Math.max(distance(b), distance(c)) * scale <= 0.25) {
      emit(d, widthAt(wd))
      return
    }
    const p = mix(a, b, 0.5),
      q = mix(b, c, 0.5),
      r = mix(c, d, 0.5),
      s = mix(p, q, 0.5),
      u = mix(q, r, 0.5),
      m = mix(s, u, 0.5),
      wm = (wa + wd) / 2
    // Here `wa` and `wd` are the parameters the half spans, not widths.
    walk(a, p, s, m, wa, wm, depth + 1)
    walk(m, u, r, d, wm, wd, depth + 1)
  }
  for (let i = 0; i < count; i++) {
    const a = path.nodes[i],
      b = path.nodes[(i + 1) % path.nodes.length]
    segment = i
    walk(a, a.out ?? a, b.in ?? b, b, 0, 1, 0)
    if (b.type === "cusp" && (i + 1 < path.nodes.length || !path.closed))
      corners.push(points.length - 1)
  }
  if (path.closed) {
    points.pop()
    widths?.pop()
  }
  return { points, widths, closed: path.closed, corners }
}

/**
 * Each node's rate of change of width, per segment, for a monotone cubic
 * through the widths (Fritsch and Carlson, 1980): level where the widths
 * turn, so a swell peaks at its node rather than past it.
 */
function widthSlopes(
  widths: readonly number[],
  closed: boolean,
  around: Readonly<{ before?: number; after?: number }>
): number[] {
  const n = widths.length
  const at = (i: number) =>
    closed
      ? widths[(i + n) % n]
      : i < 0
        ? (around.before ?? widths[0])
        : i >= n
          ? (around.after ?? widths[n - 1])
          : widths[i]
  const slopes = widths.map((_, i) => {
    const before = at(i) - at(i - 1),
      after = at(i + 1) - at(i)
    // An end with nothing beyond it leans on its one segment.
    if (!closed && i === 0 && around.before === undefined) return after
    if (!closed && i === n - 1 && around.after === undefined) return before
    return before * after <= 0 ? 0 : (before + after) / 2
  })
  const count = closed ? n : n - 1
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % n
    const d = at(i + 1) - at(i)
    if (d === 0) {
      slopes[i] = 0
      slopes[j] = 0
      continue
    }
    const a = slopes[i] / d,
      b = slopes[j] / d
    const h = a * a + b * b
    if (h > 9) {
      const t = 3 / Math.sqrt(h)
      slopes[i] = t * a * d
      slopes[j] = t * b * d
    }
  }
  return slopes
}

/** Nearest segment parameter for inserting a node, in document coordinates. */
export function nearestPathSegment(
  path: BezierPath,
  point: Point,
  transform: readonly number[]
): { index: number; t: number; distance: number } | null {
  let best: { index: number; t: number; distance: number } | null = null
  const count = path.closed ? path.nodes.length : path.nodes.length - 1
  for (let index = 0; index < count; index++) {
    const at = (t: number) => {
      const { x, y } = segmentPoint(path, index, t)
      return {
        x: transform[0] * x + transform[2] * y + transform[4],
        y: transform[1] * x + transform[3] * y + transform[5],
      }
    }
    let previous = at(0)
    for (let step = 1; step <= 128; step++) {
      const next = at(step / 128),
        dx = next.x - previous.x,
        dy = next.y - previous.y,
        length = dx * dx + dy * dy
      const fraction = length
        ? Math.max(
            0,
            Math.min(
              1,
              ((point.x - previous.x) * dx + (point.y - previous.y) * dy) /
                length
            )
          )
        : 0
      const distance = Math.hypot(
        point.x - previous.x - dx * fraction,
        point.y - previous.y - dy * fraction
      )
      if (!best || distance < best.distance)
        best = {
          index,
          t: Math.max(0.001, Math.min(0.999, (step - 1 + fraction) / 128)),
          distance,
        }
      previous = next
    }
  }
  return best
}

/**
 * The node part of `path` a press at `point` takes hold of, in document
 * coordinates, or null for none within `reach`. The nearest part wins, an
 * anchor on a tie; a handle counts only once it is pulled clear of its own
 * anchor, so one left sitting on it — a pen click that never dragged — can
 * never take a drag the anchor was meant to have.
 */
export function pickPathNode(
  path: BezierPath,
  point: Point,
  transform: readonly number[],
  reach: number,
  /** Which nodes' handles can be taken: all, none, or those it says. */
  options: { handles?: boolean | ((index: number) => boolean) } = {}
): { index: number; part: NodePart; at: Point; distance: number } | null {
  const place = (p: Point) => ({
    x: transform[0] * p.x + transform[2] * p.y + transform[4],
    y: transform[1] * p.x + transform[3] * p.y + transform[5],
  })
  let best: {
    index: number
    part: NodePart
    at: Point
    distance: number
  } | null = null
  const consider = (index: number, part: NodePart, at: Point) => {
    const distance = Math.hypot(point.x - at.x, point.y - at.y)
    if (distance <= reach && (!best || distance < best.distance))
      best = { index, part, at, distance }
  }
  path.nodes.forEach((node, index) => {
    const anchor = place(node)
    consider(index, "anchor", anchor)
    const { handles = true } = options
    if (handles === false || (handles !== true && !handles(index))) return
    for (const part of ["in", "out"] as const) {
      const handle = node[part]
      if (!handle) continue
      const at = place(handle)
      if (Math.hypot(at.x - anchor.x, at.y - anchor.y) > reach)
        consider(index, part, at)
    }
  })
  return best
}
