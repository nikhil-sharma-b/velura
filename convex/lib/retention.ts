/**
 * Time-decayed retention for version restore points (D18, §9.4): hourly for a
 * day, daily for a week, nothing beyond that.
 *
 * The rule is expressed as bucketing rather than counting because flushes are
 * not evenly spaced — an afternoon of steady painting writes one every thirty
 * seconds and an untouched week writes none — so "keep the last N" would give
 * a busy day and a quiet fortnight the same history. Bucketing by wall-clock
 * hour and day gives the artist what the labels promise instead: one point per
 * hour they worked, one per day the week before.
 *
 * The survivor of a bucket is its *newest* point, so restoring "14:00" brings
 * back everything painted up to the end of that hour rather than its first
 * thirty seconds.
 */

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

/** How long restore points stay hourly, then daily, before they are dropped. */
export const HOURLY_WINDOW_MS = DAY_MS
export const DAILY_WINDOW_MS = 7 * DAY_MS

/** Anything with a creation time can be decided about; ids are the caller's. */
export type RetainableVersion = { createdAt: number }

/**
 * Which of these restore points may be deleted, given the wall clock.
 *
 * The single newest point is always kept, whatever its age: a document last
 * touched a year ago must still offer the state it was left in, and an empty
 * history would make "go back to how it looked" unanswerable for exactly the
 * documents whose owner has forgotten what is in them.
 */
export function prunableVersions<T extends RetainableVersion>(
  versions: readonly T[],
  now: number
): T[] {
  if (versions.length === 0) return []

  // Newest first, so the first point met in a bucket is the one that stays.
  const ordered = [...versions].sort((a, b) => b.createdAt - a.createdAt)
  const newest = ordered[0]!
  const occupied = new Set<string>()

  return ordered.filter((version) => {
    if (version === newest) return false
    const bucket = bucketOf(version.createdAt, now)
    if (bucket === null) return true
    if (occupied.has(bucket)) return true
    occupied.add(bucket)
    return false
  })
}

/**
 * The slot a point competes for, or null where it has aged out of the window
 * altogether. Buckets are absolute clock divisions, not offsets from `now`, so
 * a point does not drift between buckets as the day wears on — which is what
 * makes pruning idempotent: a survivor stays a survivor until it ages out.
 */
function bucketOf(createdAt: number, now: number): string | null {
  const age = now - createdAt
  if (age < HOURLY_WINDOW_MS) return `h${Math.floor(createdAt / HOUR_MS)}`
  if (age < DAILY_WINDOW_MS) return `d${Math.floor(createdAt / DAY_MS)}`
  return null
}
