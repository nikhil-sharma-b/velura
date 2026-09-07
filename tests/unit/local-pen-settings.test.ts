import { describe, expect, test } from "bun:test"

import {
  createLocalPenSettings,
  DEFAULT_PEN_SETTINGS,
} from "@/features/studio/lib/local-pen-settings"
import {
  DEFAULT_PRESSURE_CURVE,
  pressureCurvePreset,
} from "@/engine/input/pressure-curve"

function storage(seed?: string) {
  const entries = new Map<string, string>()
  if (seed !== undefined) entries.set("velura.pen", seed)
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => void entries.set(key, value),
    entries,
  }
}

describe("pen settings kept in this browser", () => {
  test("starts on the defaults with nothing stored", () => {
    const settings = createLocalPenSettings(storage()).read()
    expect(settings).toEqual(DEFAULT_PEN_SETTINGS)
    expect(settings.tiltEnabled).toBe(true)
  })

  test("a saved curve comes back on the next visit", () => {
    const first = storage()
    const heavy = pressureCurvePreset(3)
    createLocalPenSettings(first).setPressureCurve(heavy)

    const restored = createLocalPenSettings(
      storage(first.entries.get("velura.pen"))
    ).read()
    expect(restored.pressureCurve).toEqual(heavy)
    expect(restored.tiltEnabled).toBe(true)
  })

  test("tilt stays switched off across a reload", () => {
    const first = storage()
    createLocalPenSettings(first).setTiltEnabled(false)

    const restored = createLocalPenSettings(
      storage(first.entries.get("velura.pen"))
    ).read()
    expect(restored.tiltEnabled).toBe(false)
  })

  test("the two settings do not overwrite each other", () => {
    const disk = storage()
    const settings = createLocalPenSettings(disk)
    settings.setTiltEnabled(false)
    settings.setPressureCurve(pressureCurvePreset(0))

    const restored = createLocalPenSettings(
      storage(disk.entries.get("velura.pen"))
    ).read()
    expect(restored.tiltEnabled).toBe(false)
    expect(restored.pressureCurve).toEqual(pressureCurvePreset(0))
  })

  test("notifies a subscriber, so a panel re-reads", () => {
    const settings = createLocalPenSettings(storage())
    let calls = 0
    settings.subscribe(() => calls++)
    settings.setTiltEnabled(false)
    expect(calls).toBe(1)
  })

  test("unreadable storage is the default, not a crash", () => {
    expect(createLocalPenSettings(storage("{oh no")).read()).toEqual(
      DEFAULT_PEN_SETTINGS
    )
    expect(createLocalPenSettings(storage("null")).read()).toEqual(
      DEFAULT_PEN_SETTINGS
    )
  })

  test("a stored curve the engine would reject falls back to the default", () => {
    // Written by an older version, or edited by hand: it must not reach the
    // sampler, and it must not take the tilt setting down with it.
    const doublesBack = JSON.stringify({
      pressureCurve: [
        { x: 0, y: 0 },
        { x: 0.5, y: 0.5 },
        { x: 0.5, y: 0.9 },
      ],
      tiltEnabled: false,
    })
    const restored = createLocalPenSettings(storage(doublesBack)).read()
    expect(restored.pressureCurve).toEqual(DEFAULT_PRESSURE_CURVE)
    expect(restored.tiltEnabled).toBe(false)
  })

  test("an older entry that names no tilt keeps tilt on", () => {
    const older = JSON.stringify({ pressureCurve: pressureCurvePreset(2) })
    expect(createLocalPenSettings(storage(older)).read().tiltEnabled).toBe(true)
  })

  test("a browser that refuses the write still changes the pen in hand", () => {
    const refusing = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError")
      },
    }
    const settings = createLocalPenSettings(refusing)
    expect(() => settings.setTiltEnabled(false)).not.toThrow()
    expect(settings.read().tiltEnabled).toBe(false)
  })
})
