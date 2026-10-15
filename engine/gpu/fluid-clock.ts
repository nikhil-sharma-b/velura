/**
 * The fluid simulation's clock (D42), kept pure of GPU and DOM.
 *
 * The step is fixed, so a wash ends in the same place on every machine; the
 * clock decides only how many steps a frame runs. It aims at
 * `FLUID_STEPS_PER_SECOND`, which is one a frame at 120 Hz and two at 60, and
 * gives the simulation `FLUID_BUDGET_MS` of GPU time a frame. A step the
 * frame cannot afford is skipped and not made up for later: paint moves and
 * dries more slowly in wall time and ends in the same pixels. The pen keeps
 * the rest of the frame (D30).
 */

/** The steps the clock aims at in a second. */
export const FLUID_STEPS_PER_SECOND = 120

/** The most steps a frame runs: one at 120 Hz, two at 60. */
export const FLUID_STEPS_PER_FRAME = 2

/** The simulation's share of a frame, in milliseconds of GPU time. */
export const FLUID_BUDGET_MS = 2

/**
 * What a step over one wet tile is reckoned to cost, in milliseconds, before
 * anything has been measured: the worst case (every cell wet, every
 * neighbour another colour) on an Apple M4, from the benchmark (fluid
 * brushes 13). The clock measures and moves off it as steps run.
 */
export const FLUID_TILE_STEP_MS = 0.024

/**
 * How much of what was measured before each measurement keeps: some thirty
 * frames' worth is what the reckoning is of.
 */
const DECAY = 0.97

/**
 * How firmly the reckoning holds to where it started, as tile-steps squared:
 * about what a frame of one step and one of two over 32 tiles tell it.
 */
const PRIOR_WEIGHT = 1024

/**
 * The most a measurement may be over what is reckoned, in budgets: a frame
 * the browser held up once is not a step that cost that much.
 */
const OUTLIER_BUDGETS = 4

/** Floating-point slack, so 60 Hz's 16.67 ms is two steps and not 1.9999. */
const EPSILON = 1e-6

export interface FluidClock {
  /**
   * A frame, `elapsed` milliseconds after the last, or the first since the
   * clock started; `tiles` are wet. Answers how many steps it runs.
   */
  frame(elapsed: number | undefined, tiles: number): number
  /** Steps the last frame was owed and could not afford. */
  skipped(): number
  /**
   * `steps` steps over `tiles` wet tiles were fenced at `ms`: from the work
   * before them done to theirs done. A fence resolves some time after the
   * work it waits on, a lone step's as a pair's, so what the clock reckons
   * with is what a tile-step adds, read across measurements of different
   * sizes, and not their ratio.
   */
  measured(steps: number, tiles: number, ms: number): void
  /** What a step over one wet tile is reckoned to cost, in milliseconds. */
  tileStepMs(): number
  /** Nothing is wet: forgets what was owed and what was saved. */
  stop(): void
}

export function createFluidClock(
  options: {
    /** The reckoning to start from; `FLUID_TILE_STEP_MS` where absent. */
    tileStepMs?: number
  } = {}
): FluidClock {
  const budget = FLUID_BUDGET_MS
  const prior = options.tileStepMs ?? FLUID_TILE_STEP_MS
  let perTile = prior
  // A least-squares line through what was measured, fenced milliseconds
  // against tile-steps, older measurements counting for less: its slope is
  // what a tile-step costs, its intercept the fence's latency.
  let weight = 0
  let sumX = 0
  let sumY = 0
  let sumXX = 0
  let sumXY = 0
  let skipped = 0
  /** Fractions of a step owed, carried to the next frame. */
  let owed = 0
  /** Budget saved from frames that ran nothing, toward a dear step. */
  let saved = 0

  return {
    frame(elapsed, tiles) {
      owed = Math.min(
        owed +
          (elapsed === undefined
            ? 1
            : (elapsed * FLUID_STEPS_PER_SECOND) / 1000),
        FLUID_STEPS_PER_FRAME
      )
      const due = Math.floor(owed + EPSILON)
      // Whole steps are run or skipped now; a skipped one is not owed later.
      owed = Math.max(0, owed - due)
      const cost = tiles * perTile
      let credit = saved + budget
      const steps =
        cost > 0 ? Math.min(due, Math.floor(credit / cost + EPSILON)) : due
      credit -= steps * cost
      // A frame saves only toward a step dearer than a frame's budget, which
      // would otherwise never run and the paint never dry: one such step every
      // few frames is the budget, averaged. A step that fits is paid for by
      // its own frame, so frames never bank time to burst with.
      saved = cost > budget ? Math.min(Math.max(0, credit), cost) : 0
      skipped = due - steps
      return steps
    },
    skipped: () => skipped,
    measured(steps, tiles, ms) {
      if (!(steps > 0 && tiles > 0 && ms >= 0 && Number.isFinite(ms))) return
      const x = steps * tiles
      const latency = weight > 0 ? (sumY - perTile * sumX) / weight : 0
      const y = Math.min(
        ms,
        Math.max(0, latency) + perTile * x + OUTLIER_BUDGETS * budget
      )
      weight = weight * DECAY + 1
      sumX = sumX * DECAY + x
      sumY = sumY * DECAY + y
      sumXX = sumXX * DECAY + x * x
      sumXY = sumXY * DECAY + x * y
      const variance = sumXX - (sumX * sumX) / weight
      const covariance = sumXY - (sumX * sumY) / weight
      // Measurements all of one size say nothing of the slope, and the
      // reckoning stays where it started until they differ.
      perTile = Math.max(
        0,
        (covariance + PRIOR_WEIGHT * prior) / (variance + PRIOR_WEIGHT)
      )
    },
    tileStepMs: () => perTile,
    stop() {
      owed = 0
      saved = 0
    },
  }
}
