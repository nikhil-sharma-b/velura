import { describe, expect, it } from "bun:test"

import {
  STAND_IN_PRESSURE,
  createForceSensorWatch,
} from "@/engine/input/force-sensor"

describe("createForceSensorWatch", () => {
  it("never reads a mouse or a finger as measuring force", () => {
    const watch = createForceSensorWatch()
    expect(watch.begin("mouse", 0.5)).toBe(false)
    expect(watch.read(0.8)).toBe(false)
    expect(watch.begin("touch", 0.3)).toBe(false)
    expect(watch.read(0.6)).toBe(false)
  })

  it("reads a pen held at the browser's stand-in for a whole stroke as having no sensor", () => {
    const watch = createForceSensorWatch()
    expect(watch.begin("pen", STAND_IN_PRESSURE)).toBe(false)
    for (let sample = 0; sample < 50; sample++)
      expect(watch.read(STAND_IN_PRESSURE)).toBe(false)
  })

  it("trusts a pen that lands anywhere but the stand-in from its first sample", () => {
    const watch = createForceSensorWatch()
    expect(watch.begin("pen", 0)).toBe(true)
    expect(watch.begin("pen", 0.3)).toBe(true)
  })

  it("keeps trusting a pen held steady away from the stand-in", () => {
    const watch = createForceSensorWatch()
    expect(watch.begin("pen", 0.7)).toBe(true)
    for (let sample = 0; sample < 50; sample++)
      expect(watch.read(0.7)).toBe(true)
  })

  it("trusts a pen that landed on the stand-in as soon as its pressure moves, and for the rest of the stroke", () => {
    const watch = createForceSensorWatch()
    expect(watch.begin("pen", STAND_IN_PRESSURE)).toBe(false)
    expect(watch.read(STAND_IN_PRESSURE)).toBe(false)
    expect(watch.read(0.52)).toBe(true)
    // Passing back through the stand-in is a reading like any other.
    expect(watch.read(STAND_IN_PRESSURE)).toBe(true)
  })

  it("decides each stroke afresh, since the next may come from another pen", () => {
    const watch = createForceSensorWatch()
    watch.begin("pen", 0.2)
    expect(watch.begin("pen", STAND_IN_PRESSURE)).toBe(false)
  })
})
