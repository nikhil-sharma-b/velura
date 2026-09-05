/**
 * The response curve a dynamics mapping is shaped by (D23).
 *
 * A curve is a list of points in the unit square, splined through with
 * Catmull-Rom converted to cubic beziers — the same construction the pressure
 * curve widget draws, so what an artist sees in the editor (D32) is exactly
 * what the engine evaluates. The widget imports this; the engine may not
 * import the widget (D35), so the math lives here.
 *
 * Sampling allocates nothing: it runs once per mapping per dab (D30).
 */

/** A point on a curve. Both axes are in [0, 1]. */
export type CurvePoint = { x: number; y: number }

export type Curve = readonly CurvePoint[]

/** Output follows input untouched. The default for every mapping. */
export const LINEAR_CURVE: Curve = Object.freeze([
  Object.freeze({ x: 0, y: 0 }),
  Object.freeze({ x: 1, y: 1 }),
])

/** Steps of bisection when inverting x(t). 24 lands well inside a pixel. */
const SOLVE_STEPS = 24

/** The unit range is the vocabulary of the whole graph: sources, curves, and
 * several targets are all in [0, 1]. */
export function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value
}

function cubic(a: number, b: number, c: number, d: number, t: number): number {
  const u = 1 - t
  return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d
}

/**
 * The cubic segment starting at `points[i]`, in unit space. Exported because
 * the curve editor draws exactly these beziers: what the artist sees is the
 * curve the engine samples, not a redrawing of it. Endpoints outside
 * the list mirror their neighbour, so the curve starts and ends flat-tangented
 * rather than overshooting off the edge.
 */
export function curveSegment(points: Curve, i: number) {
  const p0 = points[i - 1] ?? points[i]
  const p1 = points[i]
  const p2 = points[i + 1]
  const p3 = points[i + 2] ?? p2
  return {
    p1,
    c1: {
      x: p1.x + (p2.x - p0.x) / 6,
      y: clamp01(p1.y + (p2.y - p0.y) / 6),
    },
    c2: {
      x: p2.x - (p3.x - p1.x) / 6,
      y: clamp01(p2.y - (p3.y - p1.y) / 6),
    },
    p2,
  }
}

/**
 * The curve's output for an input in [0, 1]. Control x coordinates lie between
 * their endpoints, so x(t) is monotonic on each segment and bisection inverts
 * it without the derivative.
 */
export function sampleCurve(curve: Curve, input: number): number {
  if (curve.length < 2) return clamp01(input)
  const x = clamp01(input)
  let i = 0
  while (i < curve.length - 2 && curve[i + 1].x < x) i++
  const { p1, c1, c2, p2 } = curveSegment(curve, i)
  let low = 0
  let high = 1
  for (let step = 0; step < SOLVE_STEPS; step++) {
    const mid = (low + high) / 2
    if (cubic(p1.x, c1.x, c2.x, p2.x, mid) < x) low = mid
    else high = mid
  }
  return clamp01(cubic(p1.y, c1.y, c2.y, p2.y, (low + high) / 2))
}
