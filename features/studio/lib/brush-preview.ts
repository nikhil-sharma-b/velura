import { type Brush, brushSpacing } from "@/engine/brush/brush"
import {
  evaluateDynamics,
  NEUTRAL_STAMP_CONTEXT,
  NEUTRAL_STAMP_PARAMS,
  type StampContext,
  type StampParams,
} from "@/engine/brush/dynamics"
import type { Accumulation } from "@/engine/brush/round-brush"
import { createScatterPlacer, MAX_SCATTER_COUNT } from "@/engine/brush/scatter"

/**
 * The preview stroke of the brush editor (D32), as data.
 *
 * The dynamics graph is a pure function of a brush and a dab's context, which
 * is what lets a preview be computed here rather than drawn by the engine: no
 * device, no document, no stroke in flight, and — because nothing here touches
 * the GPU — no cost to recomputing it on every drag of a slider. The component
 * that paints these dabs is a 2D canvas and nothing more.
 *
 * What this is *not* is a second renderer. It shows what the graph does to a
 * dab over a plausible stroke; the true look of a tip texture, the paper's
 * bite and the accumulation of overlapping dabs belong to the canvas itself,
 * and the editor's job is to make the shape of a brush legible enough that it
 * is dialled in by eye rather than by trial and error on the work.
 *
 * It shows size, flow, opacity, angle, roundness, scatter and the paper's
 * bite. Per-dab colour is drawn by the canvas but not tinted here yet: that
 * arrives with the editor's Colour section (brush-library 07).
 */

export type PreviewDab = {
  /** Centre in the preview box, in its own pixels. */
  x: number
  y: number
  radius: number
  /** Opacity of this one dab: the brush's flow, as the graph modulated it. */
  opacity: number
  /** Rotation of the tip, as a turn clockwise. */
  angle: number
  /** Width against length, in (0, 1]. */
  roundness: number
}

export type BrushPreview = {
  dabs: PreviewDab[]
  /** Opacity of the whole stroke, applied once — never per dab (D27). */
  opacity: number
  accumulation: Accumulation
  /** How hard the paper bites, or zero for a brush drawing on a smooth one. */
  grainDepth: number
}

export type PreviewBox = { width: number; height: number }

/** How far the stroke bows across the box, as a fraction of its height. */
const BOW = 0.3
/** Margin at each end, so a tapered stroke is not clipped by the box. */
const MARGIN = 0.08
/** Steps the path is walked in to measure it. Well under a pixel of error. */
const WALK_STEPS = 512
/**
 * Scatter is seeded like a canvas stroke, but always with this, for the same
 * reason `randomAt` is fixed: a redraw must not reshuffle the dabs.
 */
const SCATTER_SEED = 1

/**
 * A pressure profile with a press, a body and a release: what a mark actually
 * looks like, rather than the flat one a mouse would give. The body sits at
 * full force, so an unmodulated brush previews at exactly its own radius.
 */
function pressureAt(progress: number): number {
  const ramp = 0.25
  if (progress < ramp) return progress / ramp
  if (progress > 1 - ramp) return (1 - progress) / ramp
  return 1
}

/**
 * A fresh value per dab that is nonetheless the same on every redraw. A real
 * stroke's randomness is genuinely random; a preview's may not be, or the
 * stroke would reshuffle itself under a slider that has nothing to do with it.
 */
function randomAt(index: number): number {
  const h = Math.imul(index + 1, 0x27d4eb2d) ^ 0x165667b1
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296
}

/** The point at `t` along the bowed path, and the heading there. */
function pathAt(t: number, box: PreviewBox) {
  const left = box.width * MARGIN
  const span = box.width * (1 - MARGIN * 2)
  const turn = t * Math.PI * 2
  const amplitude = box.height * BOW
  return {
    x: left + span * t,
    y: box.height / 2 - Math.sin(turn) * amplitude,
    // The path's own tangent, so `direction` means the same thing on the
    // preview as it does on the canvas.
    direction: Math.atan2(-Math.cos(turn) * amplitude * Math.PI * 2, span),
  }
}

/** Cumulative length along the path, sampled evenly in `t`. */
function walk(box: PreviewBox): number[] {
  const lengths = [0]
  let previous = pathAt(0, box)
  for (let step = 1; step <= WALK_STEPS; step++) {
    const point = pathAt(step / WALK_STEPS, box)
    lengths.push(
      lengths[step - 1] + Math.hypot(point.x - previous.x, point.y - previous.y)
    )
    previous = point
  }
  return lengths
}

/**
 * The `t` at which the path has run `distance`.
 *
 * Dabs are spaced along the path's *length*, not along its parameter, for the
 * same reason the stroke pipeline resamples by arc length: even spacing in `t`
 * would bunch the dabs where the curve is shallow and stretch them where it
 * turns, which is exactly the artefact spacing exists to avoid.
 */
function atDistance(lengths: number[], distance: number): number {
  let low = 0
  let high = lengths.length - 1
  while (low < high) {
    const mid = (low + high) >> 1
    if (lengths[mid] < distance) low = mid + 1
    else high = mid
  }
  if (low === 0) return 0
  const before = lengths[low - 1]
  const span = lengths[low] - before
  const within = span > 0 ? (distance - before) / span : 0
  return (low - 1 + within) / WALK_STEPS
}

/**
 * The stroke a brush would draw across `box`.
 *
 * The radius is capped to what the box can show. An editor whose preview
 * silently overflows tells the artist less than one whose preview stays a
 * stroke, and the radius itself is on the slider beside it.
 */
export function previewStroke(brush: Brush, box: PreviewBox): BrushPreview {
  const cap = box.height / 2
  const scale = Math.min(1, cap / Math.max(1e-6, brush.shape.radius))
  const radius = brush.shape.radius * scale
  // Spacing is scaled with the radius rather than taken from it, so a preview
  // of an oversized brush thins its dabs exactly as the canvas would.
  const spacing = Math.max(0.5, brushSpacing(brush) * scale)
  const lengths = walk(box)
  const arc = lengths[lengths.length - 1]
  const count = Math.max(2, Math.floor(arc / spacing) + 1)
  // The last dab lands at the end of the path, so the stroke fills the box
  // whatever the spacing divides into.
  const step = arc / (count - 1)
  const params: StampParams = { ...NEUTRAL_STAMP_PARAMS }
  const context: StampContext = { ...NEUTRAL_STAMP_CONTEXT }
  const dabs: PreviewDab[] = []
  const scatter = createScatterPlacer()
  scatter.begin(SCATTER_SEED)
  const offsets = new Float32Array(MAX_SCATTER_COUNT * 2)
  for (let index = 0; index < count; index++) {
    const progress = index / (count - 1)
    const point = pathAt(atDistance(lengths, index * step), box)
    context.pressure = pressureAt(progress)
    // Speed follows the same profile: a stroke is fastest through its body.
    context.velocity = pressureAt(progress)
    context.direction = (((point.direction / (Math.PI * 2)) % 1) + 1) % 1
    context.random = randomAt(index)
    context.strokeProgress = progress
    evaluateDynamics(brush.dynamics, context, params)
    const dab = {
      radius: Math.min(radius * params.size, cap),
      opacity: brush.rendering.flow * params.flow,
      angle: brush.shape.angle + params.angle,
      roundness: brush.shape.roundness * params.roundness,
    }
    const thrown = scatter.place(
      brush.scatter,
      params.scatter,
      dab.radius,
      context.direction,
      offsets
    )
    for (let i = 0; i < thrown; i++)
      dabs.push({
        ...dab,
        x: point.x + offsets[i * 2],
        y: point.y + offsets[i * 2 + 1],
      })
  }
  return {
    dabs,
    opacity: brush.rendering.opacity,
    accumulation: brush.rendering.accumulation,
    grainDepth: brush.grain?.depth ?? 0,
  }
}
