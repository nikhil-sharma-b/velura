import { describe, expect, it } from "bun:test"

import {
  DEFAULT_PRESSURE_CURVE,
  DEFAULT_PRESSURE_PRESET,
  PRESSURE_PRESET_COUNT,
  pressureCurvePreset,
  shapePressure,
  validatePressureCurve,
} from "@/engine/input/pressure-curve"
import { LINEAR_CURVE } from "@/engine/brush/curve"

describe("shapePressure", () => {
  it("passes a linear curve through untouched", () => {
    for (const pressure of [0.1, 0.25, 0.5, 0.75, 1])
      expect(shapePressure(LINEAR_CURVE, pressure)).toBeCloseTo(pressure, 5)
  })

  it("keeps a genuine zero at zero, whatever the curve", () => {
    expect(shapePressure(DEFAULT_PRESSURE_CURVE, 0)).toBe(0)
    expect(shapePressure(pressureCurvePreset(0), 0)).toBe(0)
  })

  it("holds the endpoints, so a full press stays full", () => {
    for (let position = 0; position < PRESSURE_PRESET_COUNT; position++)
      expect(shapePressure(pressureCurvePreset(position), 1)).toBeCloseTo(1, 5)
  })

  it("lifts a light touch on the light presets and drops it on the heavy ones", () => {
    const light = shapePressure(pressureCurvePreset(0), 0.5)
    const heavy = shapePressure(pressureCurvePreset(3), 0.5)
    expect(light).toBeGreaterThan(0.5)
    expect(heavy).toBeLessThan(0.5)
    expect(light).toBeGreaterThan(heavy)
  })

  it("stays monotonic, so pressing harder never draws lighter", () => {
    const curve = pressureCurvePreset(0)
    let previous = -1
    for (let p = 0; p <= 1.0001; p += 0.02) {
      const shaped = shapePressure(curve, p)
      expect(shaped).toBeGreaterThanOrEqual(previous)
      previous = shaped
    }
  })

  it("clamps a device that over-reports", () => {
    expect(shapePressure(DEFAULT_PRESSURE_CURVE, 4)).toBeCloseTo(1, 5)
  })

  it("defaults to a preset that favours a light hand", () => {
    expect(shapePressure(DEFAULT_PRESSURE_CURVE, 0.5)).toBeGreaterThan(0.5)
    expect(DEFAULT_PRESSURE_CURVE).toEqual(
      pressureCurvePreset(DEFAULT_PRESSURE_PRESET)
    )
  })
})

describe("validatePressureCurve", () => {
  it("accepts every preset", () => {
    for (let position = 0; position < PRESSURE_PRESET_COUNT; position++)
      expect(() =>
        validatePressureCurve(pressureCurvePreset(position))
      ).not.toThrow()
  })

  it("rejects points outside the unit square", () => {
    expect(() =>
      validatePressureCurve([
        { x: 0, y: 0 },
        { x: 1, y: 1.5 },
      ])
    ).toThrow(/unit square/)
  })

  it("rejects a curve that doubles back, which is not a function", () => {
    expect(() =>
      validatePressureCurve([
        { x: 0, y: 0 },
        { x: 0.5, y: 0.5 },
        { x: 0.5, y: 0.9 },
      ])
    ).toThrow(/increase along x/)
  })

  it("rejects a curve too short to sample", () => {
    expect(() => validatePressureCurve([{ x: 0, y: 0 }])).toThrow(/two points/)
  })
})
