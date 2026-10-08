import { type BrushScatter, validateScatter } from "../engine/brush/scatter"

/**
 * The painting workload the benchmark drives (D30).
 *
 * The target — 120 fps at 8192² under 10 ms pen-to-pixel — is a claim about a
 * hand painting, not about a loop spinning, so the workload is written as pen
 * samples: positions at the stylus's own rate, with the pressure taper and the
 * speed variation a real stroke has. What the engine does with them is the
 * engine's business, which is what keeps the benchmark measuring the shipped
 * stroke path rather than a copy of it.
 *
 * Generation is pure and seeded. A benchmark whose workload drifts between
 * runs cannot catch a regression, so the same seed must produce the same
 * strokes on every machine, for as long as this file is unchanged.
 */

/** One reading from the pen, in canvas pixels and milliseconds from pen-down. */
export type PenSample = {
  x: number
  y: number
  /** Force in [0, 1], as `PointerEvent.pressure` reports it. */
  pressure: number
  tiltX: number
  tiltY: number
  /** Milliseconds since this stroke's pen-down. */
  time: number
}

export type BenchStroke = { samples: PenSample[] }

export type Workload = {
  width: number
  height: number
  strokes: BenchStroke[]
  /** Everything needed to reproduce this workload, recorded with the results. */
  options: WorkloadOptions
}

export type WorkloadOptions = {
  width: number
  height: number
  /**
   * The window the document is painted through, in device pixels, with the
   * view fitted to it. Absent, the window is the document's own size — the
   * arrangement before the view transform (sharp-zoom 01), kept for the
   * ladders that measure how a frame scales with the document.
   */
  viewport?: { width: number; height: number }
  /** How many marks the pen makes. */
  strokes: number
  /** The stylus's reporting rate. 240 Hz is the fastest plausible pen (D26). */
  sampleRateHz: number
  /** Nominal hand speed in canvas pixels per second, before variation. */
  penSpeed: number
  seed: number
  /**
   * How many layers the document holds while the workload is painted. Each one
   * is given a mark of its own, so the compositor has something to flatten,
   * and the workload is painted onto a layer in the middle of the stack — with
   * a cache above it and a cache below it. Defaults to one.
   */
  layers?: number
  /**
   * Paints inside a large selection feathered by this many pixels (11): an
   * ellipse over most of the canvas, so every dab is clipped by soft
   * coverage. Absent, nothing is selected.
   */
  feather?: number
  /** Exercise all three per-dab colour targets. */
  colourDynamics?: boolean
  /**
   * Paints with a brush that scatters (§7.1). `count` multiplies the dabs
   * every spacing step lays, so this is the stamp pass at its heaviest.
   * Absent, the brush lays one dab per step.
   */
  scatter?: BrushScatter
}

/**
 * The canvas the target is stated against, at a hand speed and stroke count
 * that keep a run under about ten seconds. Changing any of this invalidates
 * comparison with recorded history, so it is a constant rather than a default.
 */
export const BENCHMARK_WORKLOAD: WorkloadOptions = Object.freeze({
  width: 8192,
  height: 8192,
  // A 1440p window: the document is 8192², the screen presenting it is not.
  viewport: Object.freeze({ width: 2560, height: 1440 }),
  strokes: 12,
  sampleRateHz: 240,
  penSpeed: 4000,
  seed: 1,
})

/** Fraction of a stroke's length spent tapering pressure at each end. */
const TAPER = 0.15

/** How far the hand speed swings either side of nominal, as a fraction. */
const SPEED_SWING = 0.45

/**
 * Mulberry32. Small, fast, and — the only property that matters here — the
 * same sequence everywhere, which a benchmark's comparability rests on.
 */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function positive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`Workload ${name} must be positive and finite.`)
}

/**
 * A stroke as a quadratic arc between two points on the canvas, sampled at the
 * pen's rate. The arc is what makes the work realistic: a straight line lets
 * the resampler and the tile grid see one direction for the whole mark, and a
 * painting stroke never does.
 */
function createStroke(
  options: WorkloadOptions,
  random: () => number
): BenchStroke {
  const margin = Math.min(options.width, options.height) * 0.08
  const span = (extent: number) => margin + random() * (extent - 2 * margin)
  const startX = span(options.width)
  const startY = span(options.height)
  const endX = span(options.width)
  const endY = span(options.height)
  // Bow the arc off the chord by up to a fifth of its length, either way.
  const chord = Math.hypot(endX - startX, endY - startY)
  const bow = (random() - 0.5) * 0.4 * chord
  const controlX = (startX + endX) / 2 - ((endY - startY) / chord) * bow
  const controlY = (startY + endY) / 2 + ((endX - startX) / chord) * bow

  // Arc length is close enough to the chord for choosing a duration; the point
  // is a plausible number of samples, not a calibrated hand.
  const period = 1000 / options.sampleRateHz
  const speed = options.penSpeed * (1 + (random() - 0.5) * SPEED_SWING)
  const count = Math.max(12, Math.round((chord / speed) * options.sampleRateHz))
  // Where within the stroke the hand slows, so speed varies along the mark
  // rather than only between marks.
  const slowAt = 0.25 + random() * 0.5
  const clamp = (value: number, limit: number) =>
    Math.min(limit, Math.max(0, value))

  const samples: PenSample[] = []
  for (let i = 0; i < count; i++) {
    const progress = i / (count - 1)
    // Ease around `slowAt`: the parameter advances more slowly there, which is
    // a hand hesitating mid-stroke and the stamp spacing bunching up.
    const eased =
      progress + 0.18 * Math.sin(Math.PI * progress) * (slowAt - progress)
    const t = clamp(eased, 1)
    const u = 1 - t
    samples.push({
      x: clamp(
        u * u * startX + 2 * u * t * controlX + t * t * endX,
        options.width
      ),
      y: clamp(
        u * u * startY + 2 * u * t * controlY + t * t * endY,
        options.height
      ),
      pressure: taper(progress),
      // A pen held at a steady lean, differing per stroke: enough for a tilt
      // mapping to have something to read without pretending to model a wrist.
      tiltX: Math.round((random() - 0.5) * 4) + Math.round((bow / chord) * 30),
      tiltY: Math.round((random() - 0.5) * 4),
      time: i * period,
    })
  }
  return { samples }
}

/** Pressure over the stroke: in from nothing, full through the body, out again. */
function taper(progress: number): number {
  const ramp = Math.min(1, progress / TAPER, (1 - progress) / TAPER)
  // Never zero: a stroke that opens at no pressure has no opening dab, and the
  // benchmark is measuring the cost of drawing, not of not drawing.
  return 0.05 + 0.95 * Math.max(0, ramp)
}

export function createWorkload(options: WorkloadOptions): Workload {
  positive(options.width, "width")
  positive(options.height, "height")
  positive(options.sampleRateHz, "sample rate")
  positive(options.penSpeed, "pen speed")
  if (!Number.isInteger(options.strokes) || options.strokes < 1)
    throw new Error("A workload must have at least one stroke.")
  if (
    options.layers !== undefined &&
    (!Number.isInteger(options.layers) || options.layers < 1)
  )
    throw new Error("A workload must have at least one layer.")
  if (
    options.feather !== undefined &&
    (!Number.isFinite(options.feather) || options.feather < 0)
  )
    throw new Error("A workload's feather must be finite and not negative.")
  if (options.scatter !== undefined) validateScatter(options.scatter)
  const random = createRandom(options.seed)
  const strokes: BenchStroke[] = []
  for (let i = 0; i < options.strokes; i++)
    strokes.push(createStroke(options, random))
  return {
    width: options.width,
    height: options.height,
    strokes,
    options: { ...options },
  }
}

/** What the workload asks of the engine, reported alongside what it cost. */
export function workloadStats(workload: Workload): {
  strokes: number
  samples: number
  penDownMs: number
} {
  let samples = 0
  let penDownMs = 0
  for (const stroke of workload.strokes) {
    samples += stroke.samples.length
    penDownMs += stroke.samples[stroke.samples.length - 1].time
  }
  return { strokes: workload.strokes.length, samples, penDownMs }
}
