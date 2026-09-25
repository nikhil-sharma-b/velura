/**
 * How a restore point is named in the panel.
 *
 * Restore points are picked by memory of the working day — "before lunch",
 * "Sunday evening" — so the label leads with the part that locates them in
 * that memory and drops the parts that do not. A calendar date on this
 * afternoon's points would make the whole ladder read alike; a weekday name
 * on a point three weeks old would be a lie by ambiguity.
 */

const DAY_MS = 24 * 60 * 60 * 1000

const TIME = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
})
const WEEKDAY = new Intl.DateTimeFormat(undefined, { weekday: "long" })
const DATE = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
})

export function restorePointLabel(createdAt: number, now: number): string {
  return `${restorePointDay(createdAt, now)} ${restorePointTime(createdAt)}`
}

/** The day a point belongs to, named the way the label names it. */
export function restorePointDay(createdAt: number, now: number): string {
  // Calendar days apart, not elapsed hours: a point from 23:00 last night is
  // "Yesterday" at nine this morning, which is how the artist thinks of it.
  const days = calendarDaysBetween(createdAt, now)
  // Clocks between two of the artist's own devices need not agree; a point
  // from a few minutes in the "future" is still one from today.
  if (days <= 0) return "Today"
  if (days === 1) return "Yesterday"
  if (days < 7) return WEEKDAY.format(createdAt)
  return DATE.format(createdAt)
}

export function restorePointTime(createdAt: number): string {
  return TIME.format(createdAt)
}

const TIME_WITH_SECONDS = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
})

/**
 * Each point's clock time, by id, with seconds added only to points that
 * would otherwise share a label — two flushes a minute apart are common, and
 * two rows reading "12:44" give the artist no way to tell which is which.
 */
export function restorePointTimes(
  points: readonly { id: string; createdAt: number }[]
): Map<string, string> {
  const counts = new Map<string, number>()
  for (const point of points) {
    const time = restorePointTime(point.createdAt)
    counts.set(time, (counts.get(time) ?? 0) + 1)
  }
  return new Map(
    points.map((point) => {
      const time = restorePointTime(point.createdAt)
      return [
        point.id,
        (counts.get(time) ?? 0) > 1
          ? TIME_WITH_SECONDS.format(point.createdAt)
          : time,
      ]
    })
  )
}

const AGO = new Intl.RelativeTimeFormat(undefined, { style: "short" })

/**
 * How long ago a point from today was — "12 min ago" places this afternoon's
 * points against each other faster than their clock times do. Older points
 * already have a day to their name, and an age in days would only repeat it.
 */
export function restorePointAge(
  createdAt: number,
  now: number
): string | undefined {
  if (calendarDaysBetween(createdAt, now) > 0) return undefined
  const minutes = Math.max(0, Math.floor((now - createdAt) / 60_000))
  if (minutes < 1) return "Just now"
  if (minutes < 60) return AGO.format(-minutes, "minute")
  return AGO.format(-Math.floor(minutes / 60), "hour")
}

/**
 * Consecutive points under the day they share, in the order given — the
 * engine lists them newest first, and so does the timeline.
 */
export function groupRestorePointsByDay<T extends { createdAt: number }>(
  points: readonly T[],
  now: number
): { day: string; points: T[] }[] {
  const groups: { day: string; points: T[] }[] = []
  for (const point of points) {
    const day = restorePointDay(point.createdAt, now)
    const last = groups.at(-1)
    if (last?.day === day) last.points.push(point)
    else groups.push({ day, points: [point] })
  }
  return groups
}

function calendarDaysBetween(from: number, to: number): number {
  return Math.round((startOfDay(to) - startOfDay(from)) / DAY_MS)
}

function startOfDay(at: number): number {
  const date = new Date(at)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}
