import { describe, expect, test } from "bun:test"
import { gestureChange, wheelChange } from "../../engine/input/view-gestures"

const close = (actual: number, expected: number, epsilon = 1e-6) =>
  expect(Math.abs(actual - expected)).toBeLessThan(epsilon)

const pair = (ax: number, ay: number, bx: number, by: number) => ({
  a: { x: ax, y: ay },
  b: { x: bx, y: by },
})

describe("two-finger gestures", () => {
  test("a drag with both fingers is a pan and nothing else", () => {
    const change = gestureChange(pair(0, 0, 100, 0), pair(20, -5, 120, -5))
    expect([change.panDx, change.panDy]).toEqual([20, -5])
    close(change.zoomFactor, 1)
    close(change.rotation, 0)
  })

  test("spreading the fingers zooms about their centre", () => {
    const change = gestureChange(pair(40, 50, 60, 50), pair(30, 50, 70, 50))
    close(change.zoomFactor, 2)
    expect([change.anchorX, change.anchorY]).toEqual([50, 50])
    close(change.panDx, 0)
  })

  test("twisting the fingers rotates by the angle they turned", () => {
    const change = gestureChange(pair(0, 0, 10, 0), pair(0, 0, 0, 10))
    close(change.rotation, Math.PI / 2)
    close(change.zoomFactor, 1)
  })

  test("fingers that land on each other do not divide by zero", () => {
    const change = gestureChange(pair(10, 10, 10, 10), pair(10, 10, 30, 10))
    close(change.zoomFactor, 1)
    close(change.rotation, 0)
  })
})

describe("the wheel", () => {
  test("scrolls the canvas under the window", () => {
    const change = wheelChange({ deltaX: 12, deltaY: -30, ctrlKey: false })
    expect(change.kind).toBe("pan")
    expect([change.panDx, change.panDy]).toEqual([-12, 30])
  })

  test("zooms when the modifier a pinch reports is set", () => {
    const change = wheelChange({ deltaX: 0, deltaY: -10, ctrlKey: true })
    expect(change.kind).toBe("zoom")
    expect(change.zoomFactor).toBeGreaterThan(1)
    expect(
      wheelChange({ deltaX: 0, deltaY: 10, ctrlKey: true }).zoomFactor
    ).toBeLessThan(1)
  })

  test("reads a wheel that reports lines rather than pixels", () => {
    const lines = wheelChange({
      deltaX: 0,
      deltaY: 3,
      ctrlKey: false,
      deltaMode: 1,
    })
    const pixels = wheelChange({ deltaX: 0, deltaY: 3, ctrlKey: false })
    expect(Math.abs(lines.panDy)).toBeGreaterThan(Math.abs(pixels.panDy))
  })

  test("clamps a violent flick so one wheel event cannot fly off", () => {
    const change = wheelChange({ deltaX: 0, deltaY: -4000, ctrlKey: true })
    expect(change.zoomFactor).toBeLessThanOrEqual(4)
    expect(change.zoomFactor).toBeGreaterThan(1)
  })
})
