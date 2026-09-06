import { describe, expect, test } from "bun:test"

import { restorePointLabel } from "../../features/studio/lib/restore-point-label"

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
