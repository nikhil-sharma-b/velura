import { describe, expect, test } from "bun:test"

import {
  groupRestorePointsByDay,
  restorePointAge,
  restorePointTimes,
  restorePointLabel,
} from "../../features/studio/lib/restore-point-label"

const NOW = new Date(2026, 0, 29, 15, 30)

function label(at: Date) {
  return restorePointLabel(at.getTime(), NOW.getTime())
}

describe("labelling a restore point by time", () => {
  test("today's points are labelled by clock time alone", () => {
    expect(label(new Date(2026, 0, 29, 9, 5))).toBe("Today 09:05")
  })

  test("yesterday is named, not dated", () => {
    expect(label(new Date(2026, 0, 28, 22, 40))).toBe("Yesterday 22:40")
  })

  test("earlier in the week is named by weekday", () => {
    // Sunday 25 January 2026.
    expect(label(new Date(2026, 0, 25, 11, 0))).toBe("Sunday 11:00")
  })

  test("a point a week back falls off the weekday naming onto a date", () => {
    // Date order is the reader's locale's business; what matters is that the
    // day and month are there at all, because the weekday no longer is.
    const older = label(new Date(2026, 0, 20, 8, 15))

    expect(older).toContain("20")
    expect(older).toContain("Jan")
    expect(older).toEndWith("08:15")
    expect(older).not.toContain("Tuesday")
  })

  test("a point later today still reads as today rather than as the future", () => {
    // Clock skew between the device that flushed and the one reading.
    expect(label(new Date(2026, 0, 29, 15, 31))).toBe("Today 15:31")
  })

  test("midnight is a clock time like any other, not an empty label", () => {
    expect(label(new Date(2026, 0, 29, 0, 0))).toBe("Today 00:00")
  })
})

describe("the version timeline", () => {
  const at = (...parts: [number, number, number, number, number]) =>
    new Date(...parts).getTime()

  test("groups points under their day, newest day first, keeping their order", () => {
    const points = [
      { id: "a", createdAt: at(2026, 0, 29, 14, 0) },
      { id: "b", createdAt: at(2026, 0, 29, 9, 5) },
      { id: "c", createdAt: at(2026, 0, 28, 22, 40) },
    ]
    const groups = groupRestorePointsByDay(points, NOW.getTime())

    expect(groups.map((group) => group.day)).toEqual(["Today", "Yesterday"])
    expect(groups[0]!.points.map((point) => point.id)).toEqual(["a", "b"])
  })

  test("adds seconds only where two points in a day share a minute", () => {
    const points = [
      { id: "a", createdAt: new Date(2026, 0, 29, 12, 44, 50).getTime() },
      { id: "b", createdAt: new Date(2026, 0, 29, 12, 44, 5).getTime() },
      { id: "c", createdAt: new Date(2026, 0, 29, 12, 5, 0).getTime() },
    ]
    const times = restorePointTimes(points)

    expect(times.get("a")).toBe("12:44:50")
    expect(times.get("b")).toBe("12:44:05")
    expect(times.get("c")).toBe("12:05")
  })

  test("says how long ago a point from today was, and nothing for older ones", () => {
    expect(restorePointAge(at(2026, 0, 29, 15, 22), NOW.getTime())).toContain(
      "8"
    )
    expect(restorePointAge(at(2026, 0, 29, 15, 30), NOW.getTime())).toBe(
      "Just now"
    )
    expect(
      restorePointAge(at(2026, 0, 28, 22, 40), NOW.getTime())
    ).toBeUndefined()
  })
})
