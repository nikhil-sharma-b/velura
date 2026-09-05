import type { FrameTiming } from "../engine"

/**
 * Turning a run's frame records into a comparable report (D30).
 *
 * Kept pure and apart from the browser so the statistics can be tested without
 * a GPU, and so a stored run can be re-summarized later under the same rules.
 */

/**
 * One frame of the engine's loop, as the engine reported it. Imported rather
 * than restated: two copies of one contract drift, and the type is all that
 * crosses — this module stays pure and testable without a GPU.
 */
export type FrameRecord = FrameTiming

/** The figures D30 states, and what the benchmark is read against. */
export const PERFORMANCE_TARGET = Object.freeze({ fps: 120, latencyMs: 10 })

/**
 * A dropped frame is one that took this much longer than the run's own cadence
 * — but never one that met the target period.
 *
 * Both halves are needed. Judged against the target alone, a paced pass on a
 * 75 Hz panel reports four frames in five dropped for running exactly as the
 * panel allows. Judged against the run's median alone, an unpaced pass reports
 * half its frames dropped, because with vsync off the median frame is the CPU
 * racing ahead at a fraction of a millisecond and anything real looks like a
 * stall beside it. A stutter is a frame that is slow both for this run and in
 * absolute terms.
 */
const DROP_THRESHOLD = 1.5

export type Distribution = {
  samples: number
  median: number
  p95: number
  p99: number
  min: number
  max: number
  mean: number
}

export type Report = {
  frames: number
  droppedFrames: number
  frameRate: {
    /** The rate half the frames beat. */
    median: number
    /**
     * The rate all but the worst 5% of frames beat — what "sustained" means
     * here. A median that clears the target while one frame in twenty stutters
     * is not a tool that feels alive, so this is the figure judged.
     */
    sustained: number
    min: number
  }
  frameIntervalMs: Distribution
  cpuMs: Distribution
  latencyMs: Distribution
  stamps: { total: number; perFrameMedian: number; perFrameMax: number }
  target: typeof PERFORMANCE_TARGET
  meetsTarget: { frameRate: boolean; latency: boolean; overall: boolean }
}

export type SummarizeOptions = {
  /**
   * Frames to discard from the front. The first frames of a run pay for shader
   * compilation, pipeline creation and cold tiles; they are real costs but
   * they are start-up costs, and averaging them into a sustained rate hides
   * whatever the steady state actually is.
   */
  warmupFrames: number
}

/** Nearest-rank percentile over a sorted copy; `fraction` is in [0, 1]. */
function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0
  const rank = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(fraction * sorted.length) - 1)
  )
  return sorted[rank]
}

function distribution(values: number[]): Distribution {
  const sorted = [...values].sort((a, b) => a - b)
  return {
    samples: sorted.length,
    median: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
    mean: sorted.length
      ? sorted.reduce((total, value) => total + value, 0) / sorted.length
      : 0,
  }
}

export function summarize(
  records: FrameRecord[],
  options: SummarizeOptions
): Report {
  const kept = records.slice(options.warmupFrames)
  // Two frames give one interval, which is not a frame rate. The floor is low
  // on purpose: what makes a run trustworthy is its length, and that is the
  // runner's business to choose, not this function's to enforce.
  if (kept.length < 10)
    throw new Error(
      `A run needs at least 10 frames after warm-up to summarize; got ${kept.length}.`
    )

  const intervals: number[] = []
  for (let i = 1; i < kept.length; i++)
    intervals.push(kept[i].start - kept[i - 1].start)
  const frameIntervalMs = distribution(intervals)
  const cadence = Math.max(
    frameIntervalMs.median,
    1000 / PERFORMANCE_TARGET.fps
  )
  const droppedFrames = intervals.filter(
    (interval) => interval > cadence * DROP_THRESHOLD
  ).length
  const latencyMs = distribution(
    kept
      .map((frame) => frame.latencyMs)
      .filter((value): value is number => value !== null)
  )
  const stampCounts = kept.map((frame) => frame.stamps)
  const stamps = distribution(stampCounts)

  // A rate is the reciprocal of an interval, so the slow tail of the intervals
  // is the slow tail of the rate: p95 interval, not p95 rate.
  const rate = (interval: number) => (interval > 0 ? 1000 / interval : 0)
  return {
    frames: kept.length,
    droppedFrames,
    frameRate: {
      median: rate(frameIntervalMs.median),
      sustained: rate(frameIntervalMs.p95),
      min: rate(frameIntervalMs.max),
    },
    frameIntervalMs,
    cpuMs: distribution(kept.map((frame) => frame.cpuMs)),
    latencyMs,
    stamps: {
      total: stampCounts.reduce((total, count) => total + count, 0),
      perFrameMedian: stamps.median,
      perFrameMax: stamps.max,
    },
    target: PERFORMANCE_TARGET,
    meetsTarget: meets(frameIntervalMs.p95, latencyMs.p95),
  }
}

/**
 * Judged on the frame interval rather than the rate it implies: a run pinned
 * to a 120 Hz display produces intervals of exactly 1000/120, and the rate
 * that comes back out of that division lands a whisker under 120.
 */
function meets(intervalP95: number, latencyP95: number) {
  const frameRate =
    intervalP95 > 0 && intervalP95 <= (1000 / PERFORMANCE_TARGET.fps) * 1.001
  // A run that drew nothing has no latency to judge, and must not pass for it.
  const latency = latencyP95 > 0 && latencyP95 <= PERFORMANCE_TARGET.latencyMs
  return { frameRate, latency, overall: frameRate && latency }
}

/**
 * The verdict across the two passes a run makes (D30).
 *
 * Throughput and latency need opposite pacing, so neither pass can answer both
 * questions. Unthrottled, the frame loop shows what the engine can sustain, but
 * the CPU runs ahead of the GPU and the queue grows until the fence that times
 * pen-to-pixel resolves seconds late. Display-paced, latency is honest and the
 * frame rate is whatever the panel allows. So each number is taken from the
 * pass that can tell the truth about it.
 */
export function judge(
  unpaced: Report,
  paced: Report
): { frameRate: boolean; latency: boolean; overall: boolean } {
  const frameRate = unpaced.meetsTarget.frameRate
  const latency = paced.meetsTarget.latency
  return { frameRate, latency, overall: frameRate && latency }
}
