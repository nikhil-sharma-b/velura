"use client"

import { useSyncExternalStore } from "react"

import {
  DEFAULT_RASTER_MAGNIFICATION,
  RASTER_MAGNIFICATIONS,
  type RasterMagnification,
} from "@/engine/view/magnification"

/**
 * How raster layers look magnified (sharp-zoom 03): an app preference kept on
 * this device, like the pen settings, because how far pixels hold up under
 * magnification depends on the screen they are looked at on.
 */

const STORAGE_KEY = "velura.magnification"

const listeners = new Set<() => void>()

export function readRasterMagnification(): RasterMagnification {
  try {
    const stored: unknown = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? "null"
    )
    return RASTER_MAGNIFICATIONS.includes(stored as RasterMagnification)
      ? (stored as RasterMagnification)
      : DEFAULT_RASTER_MAGNIFICATION
  } catch {
    // Storage that cannot be read, or holds nonsense, is the default.
    return DEFAULT_RASTER_MAGNIFICATION
  }
}

/** Chooses how raster layers look magnified from now on, on this device. */
export function writeRasterMagnification(mode: RasterMagnification) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(mode))
  } catch {
    // A private window without storage forgets it at reload; nothing breaks.
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  // Another tab's choice arrives as a storage event; this tab's own writes
  // notify directly, since the event never fires in the tab that wrote.
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) listener()
  }
  window.addEventListener("storage", onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener("storage", onStorage)
  }
}

/** The preference, kept current as it changes here or in another tab. */
export function useRasterMagnification(): RasterMagnification {
  return useSyncExternalStore(
    subscribe,
    readRasterMagnification,
    () => DEFAULT_RASTER_MAGNIFICATION
  )
}
