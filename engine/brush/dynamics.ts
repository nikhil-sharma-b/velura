import { type Curve, LINEAR_CURVE, sampleCurve } from "./curve"

/**
 * The dynamics graph (D23): how what the artist does with the pen reaches the
 * parameters of a dab.
 *
 * A brush carries a list of modulators. Each takes one input source, shapes it
 * through a curve, maps it into a range, and mixes the result onto one target
 * parameter. Evaluating the whole list is a pure function of the brush and the
 * dab's context — no device, no state, no time — which is what makes it the
 * highest-value unit-test target in the engine (D36) and what will let the
 * brush editor (D32) show a live preview without a canvas.
 *
 * What the graph produces is a *modulation*, not a finished dab: `size`,
 * `flow`, `opacity`, `roundness`, `scatter` and `pickup` scale the brush's
 * own values and `angle` and `hue` offset them. That is what lets one
 * dynamics list be shared between brushes of different sizes and read the
 * same on each.
 */

/**
 * What the artist is doing, as numbers in [0, 1].
 *
 * Everything is normalised at the boundary rather than in the graph, so a
 * curve authored in the editor means the same thing whatever the source: its
 * horizontal axis is always the full range of that input.
 */
export type DynamicsSource =
  /** Pen force, as the device reports it. */
  | "pressure"
  /** How far the pen is tilted from vertical: 0 upright, 1 flat. */
  | "tilt"
  /** Which way it leans, as a turn clockwise from +x. */
  | "tiltDirection"
  /** Speed, against a reference fast stroke. */
  | "velocity"
  /** Heading of travel, as a turn clockwise from +x. */
  | "direction"
  /** A fresh value per dab. */
  | "random"
  /** How far into the stroke this dab falls. */
  | "strokeProgress"

/**
 * A parameter of one dab.
 *
 * The list is the whole brush model, not only what the renderer reads today:
 * every target reaches the stamp pass.
 */
export type DynamicsTarget =
  /** Dab radius, as a multiple of the brush's own radius. */
  | "size"
  /** Opacity of the whole stroke. */
  | "opacity"
  /** Opacity of one dab. */
  | "flow"
  /** Rotation of the tip, as a turn. */
  | "angle"
  /** Width of the tip against its length, in (0, 1]. */
  | "roundness"
  /** How strongly canvas grain bites, in [0, 1]. */
  | "grainDepth"
  /**
   * How far dabs are thrown off the path, as a multiple of the brush's own
   * scatter amount. A brush with no amount does not scatter however this is
   * driven, which is what keeps every brush made before scatter drawing as it
   * did.
   */
  | "scatter"
  /**
   * How much a wet brush picks up, as a multiple of the brush's own pickup
   * (D41). A dry brush has none, and draws the same however this is driven.
   */
  | "pickup"
  /** Hue rotation, as a turn. */
  | "hue"
  | "saturation"
  | "lightness"

/**
 * How a mapping's output meets what is already on the target.
 *
 * - `multiply` scales it — the usual one, and what makes pressure thin a line.
 * - `add` offsets it.
 * - `replace` overrides it outright.
 */
export type DynamicsMix = "multiply" | "add" | "replace"

export type Modulator = {
  source: DynamicsSource
  target: DynamicsTarget
  /** Shapes the source before it is mapped. Omitted means linear. */
  curve?: Curve
  /** The curve's 0 and 1 in target units. Reversed ranges invert the mapping. */
  range: readonly [number, number]
  mix: DynamicsMix
}

/** One dab's worth of input, every field normalised to [0, 1]. */
export type StampContext = {
  pressure: number
  tilt: number
  tiltDirection: number
  velocity: number
  direction: number
  random: number
  strokeProgress: number
}

/** What a dab is drawn with, in the units named on `DynamicsTarget`. */
export type StampParams = {
  size: number
  opacity: number
  flow: number
  angle: number
  roundness: number
  grainDepth: number
  scatter: number
  pickup: number
  hue: number
  saturation: number
  lightness: number
}

/**
 * The parameters of a dab that nothing modulates. `size` is a multiplier, so
 * an unmodulated brush draws at exactly its own radius.
 */
export const NEUTRAL_STAMP_PARAMS: StampParams = Object.freeze({
  size: 1,
  opacity: 1,
  flow: 1,
  angle: 0,
  roundness: 1,
  grainDepth: 1,
  scatter: 1,
  pickup: 1,
  hue: 0,
  saturation: 0,
  lightness: 0,
})

/**
 * A pointer that reports nothing expressive: full force, upright, still. What
 * a mouse produces, and the baseline a test varies one source away from.
 */
export const NEUTRAL_STAMP_CONTEXT: StampContext = Object.freeze({
  pressure: 1,
  tilt: 0,
  tiltDirection: 0,
  velocity: 0,
  direction: 0,
  random: 0,
  strokeProgress: 0,
})

/** Targets measured as a turn, which wraps where the others clamp. */
type CyclicTarget = "angle" | "hue"

/** Every target, once: `evaluateDynamics` may not build this per dab (D30). */
const TARGETS = Object.freeze(
  Object.keys(NEUTRAL_STAMP_PARAMS) as DynamicsTarget[]
)

/** Turns are cyclic: an angle past a full turn is the same angle. */
const CYCLIC: ReadonlySet<DynamicsTarget> = new Set<CyclicTarget>([
  "angle",
  "hue",
])

function isCyclic(target: DynamicsTarget): target is CyclicTarget {
  return CYCLIC.has(target)
}

/**
 * What each target may hold. Mixing is unbounded arithmetic, so this is where
 * a stack of modulators is stopped from producing a negative radius or an
 * opacity above one.
 */
const LIMITS: Readonly<
  Record<Exclude<DynamicsTarget, CyclicTarget>, readonly [number, number]>
> = Object.freeze({
  size: [0, 16],
  opacity: [0, 1],
  flow: [0, 1],
  roundness: [0.01, 1],
  grainDepth: [0, 1],
  scatter: [0, 16],
  pickup: [0, 1],
  saturation: [-1, 1],
  lightness: [-1, 1],
})

/**
 * What a mapping's range may ask for, per target.
 *
 * The same numbers the evaluator clamps to, exported because an editor has to
 * offer exactly them: a range control built on its own guesses would either
 * withhold values the graph accepts or offer ones it silently takes back. A
 * turn is cyclic rather than clamped, so its range is the whole of it.
 */
export function targetLimit(target: DynamicsTarget): readonly [number, number] {
  return isCyclic(target) ? [0, 1] : LIMITS[target]
}

function applyLimit(target: DynamicsTarget, value: number): number {
  if (!Number.isFinite(value)) return NEUTRAL_STAMP_PARAMS[target]
  // Hue's authored signed magnitude must survive until its brush amplitude
  // is applied. The HSL shader wraps the scaled turn when it renders it.
  if (target === "hue") return value
  if (isCyclic(target)) return value - Math.floor(value)
  const [min, max] = LIMITS[target]
  return value < min ? min : value > max ? max : value
}

/**
 * The parameters for one dab.
 *
 * Modulators are applied in the order the brush lists them, and each sees what
 * the ones before it left. That is what makes a stack predictable: two
 * multiplies compound whichever way round they sit, and a `replace` discards
 * everything above it and nothing below. Writing into `out` lets the stroke
 * path evaluate the graph per dab without allocating (D30).
 */
export function evaluateDynamics(
  modulators: readonly Modulator[],
  context: StampContext,
  out: StampParams = { ...NEUTRAL_STAMP_PARAMS }
): StampParams {
  // The output is reused across dabs, so every target is reset rather than
  // only the ones this graph writes: yesterday's size is not today's.
  for (const target of TARGETS) out[target] = NEUTRAL_STAMP_PARAMS[target]
  for (const modulator of modulators) {
    const input = context[modulator.source]
    const shaped = sampleCurve(modulator.curve ?? LINEAR_CURVE, input)
    const [low, high] = modulator.range
    const value = low + (high - low) * shaped
    const current = out[modulator.target]
    out[modulator.target] =
      modulator.mix === "multiply"
        ? current * value
        : modulator.mix === "add"
          ? current + value
          : value
  }
  for (const target of TARGETS) out[target] = applyLimit(target, out[target])
  return out
}

/** One filtered graph per brush graph, so a stroke never filters per dab (D30). */
const WITHOUT_PRESSURE = new WeakMap<
  readonly Modulator[],
  readonly Modulator[]
>()

/**
 * The graph a device can actually drive.
 *
 * A device with no force sensor has no pressure to report, and standing in a
 * full press for it would still pick one end of each mapping's range — the
 * charcoal comes out oversized and the pencil skims the paper. Dropping the
 * pressure mappings instead leaves those targets at the brush's own values,
 * which is what the brush looks like when nothing is said about force. Every
 * other source is still read: a mouse has speed, and randomness needs no
 * device at all.
 *
 * A device that does report force keeps the graph whole, zero included.
 */
export function dynamicsForDevice(
  modulators: readonly Modulator[],
  sensesPressure: boolean
): readonly Modulator[] {
  if (sensesPressure) return modulators
  let filtered = WITHOUT_PRESSURE.get(modulators)
  if (!filtered) {
    filtered = Object.freeze(
      modulators.filter((modulator) => modulator.source !== "pressure")
    )
    WITHOUT_PRESSURE.set(modulators, filtered)
  }
  return filtered
}

const SOURCES: ReadonlySet<string> = new Set<DynamicsSource>([
  "pressure",
  "tilt",
  "tiltDirection",
  "velocity",
  "direction",
  "random",
  "strokeProgress",
])

/** Targets that start at zero, so they are offset rather than scaled. */
const OFFSET_TARGETS: ReadonlySet<DynamicsTarget> = new Set(
  TARGETS.filter((target) => NEUTRAL_STAMP_PARAMS[target] === 0)
)

/**
 * Whether a target is an offset rather than a scale.
 *
 * Exported because it is not only the validator's business: an editor has to
 * know it too, to offer `add` where a multiply would be refused, and the two
 * answering differently is exactly the drift that would let an artist build a
 * mapping the engine then throws out.
 */
export function isOffsetTarget(target: DynamicsTarget): boolean {
  return OFFSET_TARGETS.has(target)
}

const MIXES: ReadonlySet<string> = new Set<DynamicsMix>([
  "multiply",
  "add",
  "replace",
])

/**
 * Rejects a dynamics list that is not the shape the evaluator assumes.
 *
 * Brushes arrive from a library, a file, or another device (D25), so their
 * contents are input rather than code the engine wrote. Checking once at the
 * boundary is what lets evaluation stay branch-free per dab.
 */
export function validateDynamics(modulators: readonly Modulator[]): void {
  if (!Array.isArray(modulators))
    throw new Error("Brush dynamics must be a list of modulators.")
  for (const modulator of modulators) {
    if (!SOURCES.has(modulator.source))
      throw new Error(`Unknown dynamics source: ${String(modulator.source)}.`)
    if (!(modulator.target in NEUTRAL_STAMP_PARAMS))
      throw new Error(`Unknown dynamics target: ${String(modulator.target)}.`)
    if (!MIXES.has(modulator.mix))
      throw new Error(`Unknown dynamics mix mode: ${String(modulator.mix)}.`)
    // A target whose neutral value is zero is an offset, not a scale: any
    // multiply onto it yields zero whatever the source, which is never what
    // the author meant. Caught here rather than drawing an invisible stroke.
    if (modulator.mix === "multiply" && OFFSET_TARGETS.has(modulator.target))
      throw new Error(
        `The ${modulator.target} target is an offset, so it takes add or replace, not multiply.`
      )
    if (
      !Array.isArray(modulator.range) ||
      modulator.range.length !== 2 ||
      !modulator.range.every(Number.isFinite)
    )
      throw new Error("A dynamics range must be two finite numbers.")
    if (modulator.curve !== undefined) validateCurve(modulator.curve)
  }
}

/**
 * A curve has to be a function of its input to be invertible per dab, so its
 * points run left to right and stay inside the unit square.
 */
function validateCurve(curve: Curve): void {
  if (!Array.isArray(curve) || curve.length < 2)
    throw new Error("A dynamics curve needs at least two points.")
  for (const [index, point] of curve.entries()) {
    if (
      !Number.isFinite(point?.x) ||
      !Number.isFinite(point?.y) ||
      point.x < 0 ||
      point.x > 1 ||
      point.y < 0 ||
      point.y > 1
    )
      throw new Error("Dynamics curve points must lie in the unit square.")
    if (index > 0 && point.x <= curve[index - 1].x)
      throw new Error("Dynamics curve points must increase along x.")
  }
}
