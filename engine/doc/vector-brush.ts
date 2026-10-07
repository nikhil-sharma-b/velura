import { parseVectorBrush, type VectorBrush } from "../brush/vector-brush"
import {
  splitPathSegment,
  taperScale,
  type BezierPath,
  type PathNode,
} from "./vector-path"
import type { SceneCommand, VectorObject, VectorScene } from "./vector-scene"

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
  if (!object.brush || object.geometry.kind !== "path" || !object.style.stroke)
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
