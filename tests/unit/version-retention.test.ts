import { describe, expect, test } from "bun:test"

import { prunableVersions } from "../../convex/lib/retention"

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const NOW = Date.UTC(2026, 0, 29, 12, 0, 0)

type Version = { id: string; createdAt: number }

/** A version every `everyMs` for `spanMs` back from `NOW`, newest first. */
function history(everyMs: number, spanMs: number): Version[] {
  const versions: Version[] = []
  for (let age = 0; age <= spanMs; age += everyMs)
    versions.push({ id: `v${age}`, createdAt: NOW - age })
  return versions
}

function keptAfterPruning(versions: readonly Version[], now = NOW): Version[] {
  const pruned = new Set(prunableVersions(versions, now).map((v) => v.id))
  return versions.filter((version) => !pruned.has(version.id))
}

describe("time-decayed retention", () => {
  test("a run of flushes inside one clock hour collapses to its newest", () => {
    // NOW sits on the hour, so these fall in two clock hours: the instant at
    // NOW itself, and everything painted in the hour before it.
    const versions = history(5 * 60 * 1000, 50 * 60 * 1000)
    const kept = keptAfterPruning(versions)

    expect(kept.map((v) => v.id)).toEqual(["v0", "v300000"])
  })

  test("the last day keeps one restore point per hour", () => {
    const kept = keptAfterPruning(history(10 * 60 * 1000, DAY - HOUR))

    // 24 hourly buckets across the day, one survivor each.
    expect(kept.length).toBe(24)
    for (const version of kept)
      expect(NOW - version.createdAt).toBeLessThan(DAY)
  })

  test("the rest of the week thins to one restore point per day", () => {
    const kept = keptAfterPruning(history(HOUR, 7 * DAY - HOUR))
    const olderThanADay = kept.filter((v) => NOW - v.createdAt >= DAY)

    // Seven older days touched, one survivor each; the last day stays hourly.
    expect(olderThanADay.length).toBe(7)
    expect(kept.length - olderThanADay.length).toBe(24)
  })

  test("a synthetic history spanning weeks decays to a bounded set", () => {
    const versions = history(15 * 60 * 1000, 5 * 7 * DAY)
    const kept = keptAfterPruning(versions)

    expect(versions.length).toBeGreaterThan(3000)
    // ~25 hourly buckets touched in the last day plus 7 daily ones behind
    // them: the whole month before that is gone.
    expect(kept.length).toBe(32)
    for (const version of kept)
      expect(NOW - version.createdAt).toBeLessThan(7 * DAY)
  })

  test("each survivor is the newest in its bucket, so a label names real work", () => {
    const versions = history(20 * 60 * 1000, 3 * HOUR)
    const kept = keptAfterPruning(versions)

    for (const version of kept) {
      const bucket = Math.floor(version.createdAt / HOUR)
      const newerInBucket = versions.filter(
        (other) =>
          Math.floor(other.createdAt / HOUR) === bucket &&
          other.createdAt > version.createdAt
      )
      expect(newerInBucket).toEqual([])
    }
  })

  test("the newest restore point is never pruned, however old the document is", () => {
    const stale = [{ id: "only", createdAt: NOW - 300 * DAY }]

    expect(prunableVersions(stale, NOW)).toEqual([])
  })

  test("older-than-a-week points go even when a newer one shares their day", () => {
    const versions = [
      { id: "recent", createdAt: NOW - HOUR },
      { id: "week-old", createdAt: NOW - 8 * DAY },
    ]

    expect(prunableVersions(versions, NOW).map((v) => v.id)).toEqual([
      "week-old",
    ])
  })

  test("pruning is idempotent: what survives one pass survives the next", () => {
    const kept = keptAfterPruning(history(11 * 60 * 1000, 9 * DAY))

    expect(prunableVersions(kept, NOW)).toEqual([])
  })
})
