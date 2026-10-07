import { createRandom } from "./stamp-context"

/**
 * Scatter (§7.1): dabs thrown off the path rather than laid on it, and more
 * than one of them per spacing step. What foliage, sparkle, debris and spray
 * are made of.
 *
 * Placement is seeded per stroke, so a stroke replayed — after a mispredicted
 * tail is discarded (D26), or by a test — lands every dab where it landed
 * before. It draws from its own stream rather than from the `random` source
 * the dynamics graph reads, so turning scatter on does not reshuffle which
 * dab a `random` size mapping makes large.
 */

/**
 * Which way a dab may be thrown. `across` keeps it on a line perpendicular to
 * travel, which widens the stroke without breaking up its rhythm; `both` lets
 * it wander along the path too, which is what spray and foliage want.
 */
export type ScatterAxes = "across" | "both"

export type BrushScatter = {
  /**
   * How far a dab may be thrown on each axis, in dab radii. The dynamics
   * graph's `scatter` target scales it per dab.
   */
  amount: number
  /**
   * Dabs laid per spacing step. They are laid even where the amount comes to
   * nothing, stacked on the path: under coverage that is one pass, and under
   * buildup it is `count` passes, which is what a dense brush is (D27).
   */
  count: number
  axes: ScatterAxes
}

/** What a brush with no scatter section draws: one dab, on the path. */
export const NO_SCATTER: BrushScatter = Object.freeze({
  amount: 0,
  count: 1,
  axes: "across",
})

/**
 * Enough for a dense spray, and a ceiling on how far one spacing step can
 * multiply the stamp pass (D30).
 */
export const MAX_SCATTER_COUNT = 16
/** Far enough to scatter a spray well wide of its path. */
export const MAX_SCATTER_AMOUNT = 16

/**
 * Keeps the placement stream apart from the tracker's `random`, which is
 * seeded with the same per-stroke number.
 */
const STREAM = 0x9e3779b9

const TAU = Math.PI * 2

export interface ScatterPlacer {
  /** Opens a stroke. The same seed places the same dabs. */
  begin(seed: number): void
  /**
   * Writes one spacing step's dabs into `out` as `[dx, dy]` pairs in canvas
   * pixels, and returns how many there are. `scale` is what the dynamics graph
   * made of the `scatter` target; `direction` is the heading of travel, as a
   * turn clockwise from +x.
   */
  place(
    scatter: BrushScatter | undefined,
    scale: number,
    radius: number,
    direction: number,
    out: Float32Array
  ): number
}

/** Writes into the caller's array, so a stroke allocates nothing (D30). */
export function createScatterPlacer(): ScatterPlacer {
  let random = createRandom(STREAM)
  return {
    begin(seed) {
      random = createRandom((seed ^ STREAM) >>> 0)
    },
    place(scatter, scale, radius, direction, out) {
      const { amount, count, axes } = scatter ?? NO_SCATTER
      const reach = amount * scale * radius
      if (reach === 0) {
        // Exactly on the path, and without drawing from the stream: a brush
        // that does not scatter draws what it drew before scatter existed.
        for (let i = 0; i < count; i++) {
          out[i * 2] = 0
          out[i * 2 + 1] = 0
        }
        return count
      }
      const heading = direction * TAU
      const alongX = Math.cos(heading)
      const alongY = Math.sin(heading)
      for (let i = 0; i < count; i++) {
        const across = (random() * 2 - 1) * reach
        const along = axes === "both" ? (random() * 2 - 1) * reach : 0
        // Across is a quarter turn clockwise from travel: (-y, x) in a
        // y-down canvas.
        out[i * 2] = alongX * along - alongY * across
        out[i * 2 + 1] = alongY * along + alongX * across
      }
      return count
    },
  }
}

/** Rejects a scatter section that is not the shape the placer assumes. */
export function validateScatter(scatter: unknown): void {
  const { amount, count, axes } = (scatter ?? {}) as Partial<BrushScatter>
  if (
    typeof amount !== "number" ||
    !Number.isFinite(amount) ||
    amount < 0 ||
    amount > MAX_SCATTER_AMOUNT
  )
    throw new Error(
      `Brush scatter amount must be between 0 and ${MAX_SCATTER_AMOUNT}.`
    )
  if (
    typeof count !== "number" ||
    !Number.isInteger(count) ||
    count < 1 ||
    count > MAX_SCATTER_COUNT
  )
    throw new Error(
      `Brush scatter count must be a whole number from 1 to ${MAX_SCATTER_COUNT}.`
    )
  if (axes !== "across" && axes !== "both")
    throw new Error("Brush scatter axes must be across or both.")
}
