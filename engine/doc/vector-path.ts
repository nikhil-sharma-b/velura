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

export function fitPressureStroke(
  samples: readonly PressurePoint[],
  width: number
): BezierPath {
  if (!Number.isFinite(width) || width <= 0 || !samples.length)
    throw new Error("A pressure stroke needs samples and a positive width.")
  const sampled: PathNode[] = samples.map((p) => {
    if (![p.x, p.y, p.pressure].every(Number.isFinite))
      throw new Error("Pressure samples must be finite.")
    return {
      x: p.x,
      y: p.y,
      width: width * Math.max(0, Math.min(1, p.pressure)),
      in: null,
      out: null,
      type: "smooth" as const,
    }
  })
  // Simplify in both position and width: a straight line still needs an
  // anchor wherever pressure changes beyond a quarter document pixel.
  // An explicit stack avoids recursion limits on long tablet gestures.
  const keep = new Set([0, sampled.length - 1])
  const pending = [[0, sampled.length - 1]]
  while (pending.length) {
    const [first, last] = pending.pop()!
    const a = sampled[first],
      b = sampled[last]
    const dx = b.x - a.x,
      dy = b.y - a.y,
      length = dx * dx + dy * dy
    let largest = 0.25,
      split = -1
    for (let i = first + 1; i < last; i++) {
      const p = sampled[i]
      const t = length
        ? Math.max(
            0,
            Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)
          )
        : (i - first) / (last - first)
      const error = Math.max(
        Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy),
        Math.abs(p.width! - (a.width! + (b.width! - a.width!) * t))
      )
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
  const nodes = sampled.filter((_, index) => keep.has(index))
  // A single press is a round dot, kept as a zero-length editable centre line.
  if (nodes.length === 1) nodes.push({ ...nodes[0] })
  return {
    kind: "path",
    nodes: nodes.map((n, i) => {
      const before = nodes[Math.max(0, i - 1)]
      const after = nodes[Math.min(nodes.length - 1, i + 1)]
      const inLength = Math.hypot(n.x - before.x, n.y - before.y)
      const outLength = Math.hypot(after.x - n.x, after.y - n.y)
      // Where the hand turned sharply, keep the corner: a smooth node's
      // handles would carry the curve past it and back, overshooting.
      const turn =
        inLength && outLength
          ? ((n.x - before.x) * (after.x - n.x) +
              (n.y - before.y) * (after.y - n.y)) /
            (inLength * outLength)
          : 1
      if (turn < CORNER_COS && i > 0 && i < nodes.length - 1)
        return { ...n, in: null, out: null, type: "cusp" as const }
      return { ...n, ...chordHandles(nodes, i, false) }
    }),
    closed: false,
  }
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

export function editPathNode(path: BezierPath, edit: NodeEdit): BezierPath {
  if (edit.type === "split") return splitPathSegment(path, edit.index, edit.t)
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
const handleOf = (n: PathNode, h: Point | null) =>
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
  scale = 1
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
  emit(path.nodes[0], path.nodes[0].width ?? 0)
  if (path.nodes[0].type === "cusp") corners.push(0)
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
      emit(d, wd)
      return
    }
    const p = mix(a, b, 0.5),
      q = mix(b, c, 0.5),
      r = mix(c, d, 0.5),
      s = mix(p, q, 0.5),
      u = mix(q, r, 0.5),
      m = mix(s, u, 0.5),
      wm = (wa + wd) / 2
    walk(a, p, s, m, wa, wm, depth + 1)
    walk(m, u, r, d, wm, wd, depth + 1)
  }
  for (let i = 0; i < count; i++) {
    const a = path.nodes[i],
      b = path.nodes[(i + 1) % path.nodes.length]
    walk(a, a.out ?? a, b.in ?? b, b, a.width ?? 0, b.width ?? 0, 0)
    if (b.type === "cusp" && (i + 1 < path.nodes.length || !path.closed))
      corners.push(points.length - 1)
  }
  if (path.closed) {
    points.pop()
    widths?.pop()
  }
  return { points, widths, closed: path.closed, corners }
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
    const a = path.nodes[index],
      d = path.nodes[(index + 1) % path.nodes.length],
      b = a.out ?? a,
      c = d.in ?? d
    const at = (t: number) => {
      const u = 1 - t,
        x =
          u * u * u * a.x +
          3 * u * u * t * b.x +
          3 * u * t * t * c.x +
          t * t * t * d.x,
        y =
          u * u * u * a.y +
          3 * u * u * t * b.y +
          3 * u * t * t * c.y +
          t * t * t * d.y
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
