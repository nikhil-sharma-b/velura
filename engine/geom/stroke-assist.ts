/**
 * Stroke assist (17): a line the pen is held to. Samples are projected onto
 * it before the stabilizer sees them, and only their position moves — the
 * pressure and tilt reported with each sample stay with it, so a ruled line
 * keeps every bit of the brush's dynamics.
 *
 * Three things can supply the line, chosen once as the pen goes down: a
 * line from where the last stroke ended (a modifier held at pen-down), the
 * straight-edge the artist placed on the canvas, or a guide the stroke began
 * close to.
 */

import type { Guide } from "../doc/guides"

type Point = { x: number; y: number }

/** A straight-edge on the canvas: a point it passes through and its angle. */
export type StraightEdge = Readonly<{ x: number; y: number; angle: number }>

/** A point on the line and a unit direction along it. */
export type AssistLine = Readonly<{
  x: number
  y: number
  dx: number
  dy: number
}>

export function edgeLine(edge: StraightEdge): AssistLine {
  return {
    x: edge.x,
    y: edge.y,
    dx: Math.cos(edge.angle),
    dy: Math.sin(edge.angle),
  }
}

/** Reused across calls, so the per-sample path allocates nothing (D30). */
const projected: Point = { x: 0, y: 0 }

/**
 * The foot of the perpendicular from (x, y) to `line`. The returned point is
 * shared between calls — copy it to keep it.
 */
export function projectOntoLine(line: AssistLine, x: number, y: number): Point {
  const along = (x - line.x) * line.dx + (y - line.y) * line.dy
  projected.x = line.x + line.dx * along
  projected.y = line.y + line.dy * along
  return projected
}

export type AssistChoice = {
  line: AssistLine
  /** Where the stroke opens: the pen-down point, moved onto the line. */
  start: Point
}

/**
 * The line a stroke opening at (x, y) follows, if any. From the last point
 * outranks the straight-edge, which outranks a guide: each is a more
 * deliberate ask than the one after it.
 */
export function assistLine(options: {
  x: number
  y: number
  guides: readonly Guide[]
  /** How near, in document pixels, a guide has to be to catch the stroke. */
  guideReach: number
  edge?: StraightEdge | null
  fromLast?: Point | null
}): AssistChoice | null {
  const { x, y, fromLast, edge } = options
  if (fromLast) {
    const length = Math.hypot(x - fromLast.x, y - fromLast.y)
    // Pen-down on the very spot the last stroke ended gives no direction;
    // any line through it will do, and the stroke starts there regardless.
    const line =
      length > 0
        ? {
            x: fromLast.x,
            y: fromLast.y,
            dx: (x - fromLast.x) / length,
            dy: (y - fromLast.y) / length,
          }
        : { x: fromLast.x, y: fromLast.y, dx: 1, dy: 0 }
    return { line, start: { x: fromLast.x, y: fromLast.y } }
  }
  if (edge) return choose(edgeLine(edge), x, y)
  let nearest: Guide | null = null
  let distance = options.guideReach
  for (const guide of options.guides) {
    const away = Math.abs((guide.axis === "x" ? x : y) - guide.position)
    if (away <= distance) {
      nearest = guide
      distance = away
    }
  }
  if (!nearest) return null
  return choose(
    nearest.axis === "x"
      ? { x: nearest.position, y: 0, dx: 0, dy: 1 }
      : { x: 0, y: nearest.position, dx: 1, dy: 0 },
    x,
    y
  )
}

function choose(line: AssistLine, x: number, y: number): AssistChoice {
  const start = projectOntoLine(line, x, y)
  return { line, start: { x: start.x, y: start.y } }
}

/** The pipeline stage: holds one stroke's line and projects its samples. */
export interface StrokeAssist {
  /** Opens a stroke on `line`, or unassisted when null. */
  begin(line: AssistLine | null): void
  /** The sample's position on the line; shared between calls. */
  filter(x: number, y: number): Point
}

export function createStrokeAssist(): StrokeAssist {
  let active: AssistLine | null = null
  const passthrough: Point = { x: 0, y: 0 }
  return {
    begin(line) {
      active = line
    },
    filter(x, y) {
      if (active) return projectOntoLine(active, x, y)
      passthrough.x = x
      passthrough.y = y
      return passthrough
    },
  }
}
