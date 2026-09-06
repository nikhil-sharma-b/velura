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
  const time = TIME.format(createdAt)
  // Calendar days apart, not elapsed hours: a point from 23:00 last night is
  // "Yesterday" at nine this morning, which is how the artist thinks of it.
  const days = calendarDaysBetween(createdAt, now)
  // Clocks between two of the artist's own devices need not agree; a point
  // from a few minutes in the "future" is still one from today.
  if (days <= 0) return `Today ${time}`
  if (days === 1) return `Yesterday ${time}`
  if (days < 7) return `${WEEKDAY.format(createdAt)} ${time}`
  return `${DATE.format(createdAt)} ${time}`
}

function calendarDaysBetween(from: number, to: number): number {
  return Math.round((startOfDay(to) - startOfDay(from)) / DAY_MS)
}

function startOfDay(at: number): number {
  const date = new Date(at)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}
