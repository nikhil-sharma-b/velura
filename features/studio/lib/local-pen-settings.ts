"use client"

import { useSyncExternalStore } from "react"

import type { Curve } from "@/engine/brush/curve"
import {
  DEFAULT_PRESSURE_CURVE,
  validatePressureCurve,
} from "@/engine/input/pressure-curve"

const STORAGE_KEY = "velura.pen"

/** The slice of `Storage` this needs, so a test can stand one up in a Map. */
type KeyValueStorage = Pick<Storage, "getItem" | "setItem">

/** How the artist's pen is read, before any brush sees a sample. */
export type PenSettings = Readonly<{
  pressureCurve: Curve
  tiltEnabled: boolean
}>

export const DEFAULT_PEN_SETTINGS: PenSettings = Object.freeze({
  pressureCurve: DEFAULT_PRESSURE_CURVE,
  tiltEnabled: true,
})

/**
 * The pen calibration for this browser.
 *
 * Kept apart from the brush library on purpose: a brush is work, and it
 * follows the artist into their account and onto their other machines. How
 * hard this particular hand presses on this particular pen is not work — it
 * describes the device on the desk, and carrying it to a different one would
 * be carrying the wrong answer there. So it stays local even once there is an
 * account to sync it to.
 *
 * It does have to survive a reload, though. Calibrating pressure once and
 * finding it reset on the next visit is worse than never having offered it.
 */
export function createLocalPenSettings(storage: KeyValueStorage) {
  let state = read(storage)
  const listeners = new Set<() => void>()

  function commit(next: PenSettings) {
    state = Object.freeze(next)
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      // A browser that refuses the write (private mode, a full quota) costs
      // the artist persistence, not the pen in their hand right now.
    }
    for (const listener of listeners) listener()
  }

  return {
    read: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    setPressureCurve(pressureCurve: Curve) {
      commit({ ...state, pressureCurve })
    },
    setTiltEnabled(tiltEnabled: boolean) {
      commit({ ...state, tiltEnabled })
    },
  }
}

function read(storage: KeyValueStorage): PenSettings {
  try {
    const stored = storage.getItem(STORAGE_KEY)
    const parsed: unknown = stored ? JSON.parse(stored) : null
    if (typeof parsed !== "object" || parsed === null)
      return DEFAULT_PEN_SETTINGS
    const record = parsed as Record<string, unknown>
    return Object.freeze({
      pressureCurve: readCurve(record.pressureCurve),
      // Anything but an explicit false is on: a stored value written by an
      // older version of this app names no tilt at all, and a pen that
      // reports tilt should use it until the artist says otherwise.
      tiltEnabled: record.tiltEnabled !== false,
    })
  } catch {
    // Storage is shared with whatever else this origin has ever written and
    // with older versions of this app: unreadable is the default, never a
    // crash on the way into the studio.
    return DEFAULT_PEN_SETTINGS
  }
}

/**
 * A stored curve is input, not code this app wrote: it may have been authored
 * by an older version, or edited by hand. One the engine would reject is
 * dropped for the default rather than carried to the sampler.
 */
function readCurve(value: unknown): Curve {
  if (!Array.isArray(value)) return DEFAULT_PRESSURE_CURVE
  const points = value.flatMap((entry: unknown) => {
    const point = entry as Partial<{ x: number; y: number }>
    return Number.isFinite(point?.x) && Number.isFinite(point?.y)
      ? [{ x: Number(point.x), y: Number(point.y) }]
      : []
  })
  try {
    validatePressureCurve(points)
    return points
  } catch {
    return DEFAULT_PRESSURE_CURVE
  }
}

function memoryStorage(): KeyValueStorage {
  const entries = new Map<string, string>()
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => void entries.set(key, value),
  }
}

/**
 * The browser-local pen settings, as a hook and its two writers.
 *
 * Server rendering has no storage, and a browser can refuse it outright: a
 * store with nowhere to write still works for the length of the session.
 */
export function createLocalPenSettingsStore(
  storage: KeyValueStorage | undefined = globalThis.localStorage
) {
  const local = createLocalPenSettings(storage ?? memoryStorage())
  return {
    usePenSettings: () =>
      useSyncExternalStore(
        local.subscribe,
        local.read,
        () =>
          // The server has no stored answer, and rendering one it cannot know
          // would make the first paint disagree with the browser's own.
          DEFAULT_PEN_SETTINGS
      ),
    setPressureCurve: local.setPressureCurve,
    setTiltEnabled: local.setTiltEnabled,
  }
}

export type PenSettingsStore = ReturnType<typeof createLocalPenSettingsStore>
