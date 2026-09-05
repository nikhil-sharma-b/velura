import { describe, expect, test } from "bun:test"
import { createStrokeResampler } from "../../engine/geom/path"

type Stamp = { x: number; y: number }

function collect(
  spacing: number,
  points: readonly Stamp[],
  { close = true } = {}
): Stamp[] {
  const stamps: Stamp[] = []
  const emit = (x: number, y: number) => stamps.push({ x, y })
  const resampler = createStrokeResampler(spacing)
  resampler.begin(points[0].x, points[0].y, 1, 0, 0, 0, emit)
  for (const point of points.slice(1))
    resampler.extend(point.x, point.y, 1, 0, 0, 0, emit)
  if (close) resampler.end(emit)
  return stamps
}

function gaps(stamps: readonly Stamp[]): number[] {
  const distances: number[] = []
  for (let i = 1; i < stamps.length; i++)
    distances.push(
      Math.hypot(stamps[i].x - stamps[i - 1].x, stamps[i].y - stamps[i - 1].y)
    )
  return distances
}

/** Samples along a straight line, `step` pixels apart: one drawing speed. */
function line(from: Stamp, to: Stamp, step: number): Stamp[] {
  const span = Math.hypot(to.x - from.x, to.y - from.y)
  const count = Math.round(span / step)
  return Array.from({ length: count + 1 }, (_, i) => ({
    x: from.x + ((to.x - from.x) * i) / count,
    y: from.y + ((to.y - from.y) * i) / count,
  }))
}

function arc(radius: number, sweep: number, step: number): Stamp[] {
  const count = Math.round((radius * sweep) / step)
  return Array.from({ length: count + 1 }, (_, i) => {
    const angle = (sweep * i) / count
    return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) }
  })
}

describe("arc-length resampling", () => {
  test("a stroke begins with a stamp under the pen", () => {
    expect(collect(4, [{ x: 10, y: 20 }])).toEqual([{ x: 10, y: 20 }])
  })

  test("stamps along a straight line are spaced by exactly the spacing", () => {
    const stamps = collect(5, line({ x: 0, y: 0 }, { x: 100, y: 0 }, 10))
    for (const gap of gaps(stamps)) expect(gap).toBeCloseTo(5, 6)
    expect(stamps[0]).toEqual({ x: 0, y: 0 })
    expect(stamps.at(-1)!.x).toBeGreaterThan(94)
  })

  test("a fast stroke and a slow stroke resample to the same spacing", () => {
    // The same geometry sampled at 40 px apart (a flick) and 2 px apart (a
    // careful drag). Speed changes the input rate, never the stamp spacing.
    const fast = collect(6, line({ x: 0, y: 0 }, { x: 200, y: 60 }, 40))
    const slow = collect(6, line({ x: 0, y: 0 }, { x: 200, y: 60 }, 2))
    for (const gap of [...gaps(fast), ...gaps(slow)])
      expect(gap).toBeCloseTo(6, 6)
    expect(Math.abs(fast.length - slow.length)).toBeLessThanOrEqual(1)
  })

  test("a fast curve and a slow curve resample to the same spacing", () => {
    const fast = collect(4, arc(80, Math.PI / 2, 30))
    const slow = collect(4, arc(80, Math.PI / 2, 3))
    // Stamps sit on chords of the walked spline, so spacing on a curve is
    // exact to within the walk step rather than to floating-point precision.
    for (const gap of [...gaps(fast), ...gaps(slow)])
      expect(gap).toBeCloseTo(4, 2)
    // Both traverse the same arc, so they end within a stamp of each other.
    expect(
      Math.hypot(
        fast.at(-1)!.x - slow.at(-1)!.x,
        fast.at(-1)!.y - slow.at(-1)!.y
      )
    ).toBeLessThan(4)
  })

  test("spacing is carried across input samples rather than reset per segment", () => {
    // Sample step (7) is not a multiple of the spacing (5): restarting the
    // count at each sample would produce a visible beat in the gaps.
    const stamps = collect(5, line({ x: 0, y: 0 }, { x: 70, y: 0 }, 7))
    for (const gap of gaps(stamps)) expect(gap).toBeCloseTo(5, 6)
  })

  test("the curve bows through the sampled points rather than cutting corners", () => {
    const stamps = collect(2, [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 100, y: 50 },
      { x: 100, y: 100 },
    ])
    // A polyline through the corner would leave stamps exactly on y=0 up to
    // x=50; a curve through it lifts off before the corner.
    const nearCorner = stamps.filter((s) => s.x > 30 && s.x < 50)
    expect(nearCorner.some((s) => Math.abs(s.y) > 0.5)).toBe(true)
    // And it still passes close to the sampled point itself.
    expect(
      Math.min(...stamps.map((s) => Math.hypot(s.x - 50, s.y)))
    ).toBeLessThan(2)
  })

  test("ending the stroke flushes the tail up to the last sample", () => {
    const points = line({ x: 0, y: 0 }, { x: 40, y: 0 }, 10)
    const open = collect(3, points, { close: false })
    const closed = collect(3, points)
    expect(closed.length).toBeGreaterThan(open.length)
    expect(closed.at(-1)!.x).toBeGreaterThan(37)
  })

  test("repeated samples at one position emit no further stamps", () => {
    const stamps = collect(3, [
      { x: 5, y: 5 },
      { x: 5, y: 5 },
      { x: 5, y: 5 },
    ])
    expect(stamps).toEqual([{ x: 5, y: 5 }])
  })

  test("a resampler can be reused for a second stroke", () => {
    const resampler = createStrokeResampler(5)
    const first: Stamp[] = []
    resampler.begin(0, 0, 1, 0, 0, 0, (x, y) => first.push({ x, y }))
    resampler.extend(30, 0, 1, 0, 0, 0, (x, y) => first.push({ x, y }))
    resampler.end((x, y) => first.push({ x, y }))
    const second: Stamp[] = []
    resampler.begin(100, 100, 1, 0, 0, 0, (x, y) => second.push({ x, y }))
    resampler.extend(130, 100, 1, 0, 0, 0, (x, y) => second.push({ x, y }))
    resampler.end((x, y) => second.push({ x, y }))
    expect(second[0]).toEqual({ x: 100, y: 100 })
    // No carried distance and no stale control points leak across strokes.
    for (const gap of gaps(second)) expect(gap).toBeCloseTo(5, 6)
    expect(second.length).toBe(first.length)
  })

  test("a long stroke emits through the callback without collecting a path", () => {
    // The per-frame path hands each stamp to the caller as plain numbers, so
    // nothing accumulates inside the resampler however long the stroke runs.
    const resampler = createStrokeResampler(2)
    let count = 0
    const emit = () => {
      count++
    }
    resampler.begin(0, 0, 1, 0, 0, 0, emit)
    for (let i = 1; i <= 2000; i++)
      resampler.extend(i, Math.sin(i / 10) * 20, 1, 0, 0, 0, emit)
    resampler.end(emit)
    expect(count).toBeGreaterThan(1000)
  })
})

describe("pen state along the path", () => {
  type Dab = {
    x: number
    pressure: number
    tiltX: number
    time: number
  }

  /** A straight run from 0 to 100 with pressure and tilt ramping across it. */
  function ramp(): Dab[] {
    const dabs: Dab[] = []
    const emit = (
      x: number,
      _y: number,
      pressure: number,
      tiltX: number,
      _tiltY: number,
      time: number
    ) => dabs.push({ x, pressure, tiltX, time })
    const resampler = createStrokeResampler(5)
    resampler.begin(0, 0, 0, 0, 0, 0, emit)
    for (let i = 1; i <= 5; i++)
      resampler.extend(i * 20, 0, i / 5, i * 10, 0, i * 100, emit)
    resampler.end(emit)
    return dabs
  }

  test("pressure rises with the dab, not in steps at the input samples", () => {
    const dabs = ramp()
    // Pressure was reported at 20-pixel intervals and dabs land every 5, so a
    // held value would repeat four times over before jumping.
    for (let i = 1; i < dabs.length; i++)
      expect(dabs[i].pressure).toBeGreaterThan(dabs[i - 1].pressure)
  })

  test("pen state is the reported value where a sample actually falls", () => {
    const dabs = ramp()
    const atForty = dabs.find((dab) => Math.abs(dab.x - 40) < 1e-6)!
    // The pen reported 0.4 at x = 40; the interpolation must not smear it.
    expect(atForty.pressure).toBeCloseTo(0.4, 3)
    expect(atForty.tiltX).toBeCloseTo(20, 3)
    expect(atForty.time).toBeCloseTo(200, 3)
  })

  test("interpolated values never leave the range the pen reported", () => {
    for (const dab of ramp()) {
      expect(dab.pressure).toBeGreaterThanOrEqual(0)
      expect(dab.pressure).toBeLessThanOrEqual(1)
      expect(dab.tiltX).toBeLessThanOrEqual(50)
    }
  })

  test("the clock advances monotonically along the stroke", () => {
    const dabs = ramp()
    for (let i = 1; i < dabs.length; i++)
      expect(dabs[i].time).toBeGreaterThanOrEqual(dabs[i - 1].time)
  })
})
