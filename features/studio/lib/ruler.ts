/**
 * Where a ruler's labels go (16). A ruler reads document pixels along one
 * screen edge; under a turned or flipped view that reading is still linear in
 * screen distance, so the host hands in "which document coordinate is at this
 * many CSS pixels along" and gets back the round values in view and where
 * each one sits.
 */

export type RulerTick = Readonly<{ value: number; at: number }>

/**
 * The smallest round step — 1, 2 or 5 times a power of ten — whose labels
 * sit at least `minSpacing` CSS pixels apart at `zoom` CSS pixels per
 * document pixel.
 */
export function rulerStep(zoom: number, minSpacing: number): number {
  const least = minSpacing / zoom
  let power = 10 ** Math.floor(Math.log10(least))
  for (;;) {
    for (const factor of [1, 2, 5]) {
      const step = factor * power
      // A hair of tolerance so an exact fit is not pushed a step further by
      // floating point.
      if (step * zoom >= minSpacing - 1e-9) return step
    }
    power *= 10
  }
}

export function rulerTicks(
  docAt: (screen: number) => number,
  length: number,
  minSpacing: number
): RulerTick[] {
  const origin = docAt(0)
  const slope = docAt(1) - origin
  if (!Number.isFinite(slope) || Math.abs(slope) < 1e-12) return []
  const step = rulerStep(1 / Math.abs(slope), minSpacing)
  const end = origin + slope * length
  const low = Math.min(origin, end)
  const high = Math.max(origin, end)
  const ticks: RulerTick[] = []
  for (let n = Math.ceil(low / step - 1e-9); n * step <= high + 1e-9; n++) {
    const value = Number((n * step).toPrecision(12))
    // `+ 0` folds a negative zero, which a label would print as "-0".
    const at = Math.round(((value - origin) / slope) * 1000) / 1000 + 0
    ticks.push({ value, at })
  }
  return ticks.sort((a, b) => a.at - b.at)
}
