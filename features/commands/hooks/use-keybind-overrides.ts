"use client"

import { useMemo, useSyncExternalStore } from "react"

import {
  applyOverrides,
  parseOverrides,
  type KeybindOverrides,
} from "../lib/overrides"
import type { Registry } from "../lib/registry"

const STORAGE_KEY = "velura.keybinds"
const EMPTY: KeybindOverrides = {}

const listeners = new Set<() => void>()
// Parsed once per stored string, so every read between writes is the same
// object and React sees no change.
let cached: { raw: string | null; overrides: KeybindOverrides } = {
  raw: null,
  overrides: EMPTY,
}

function read(): KeybindOverrides {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(STORAGE_KEY)
  } catch {
    // Storage that cannot be read is storage with nothing in it.
  }
  if (raw !== cached.raw) {
    let parsed: unknown
    try {
      parsed = raw === null ? {} : JSON.parse(raw)
    } catch {
      parsed = {}
    }
    cached = { raw, overrides: parseOverrides(parsed) }
  }
  return cached.overrides
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  // Another tab's change arrives as a storage event; this tab's own writes
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

/** Stores the artist's keybind overrides on this device and tells every reader. */
export function writeKeybindOverrides(overrides: KeybindOverrides) {
  try {
    if (Object.keys(overrides).length === 0)
      localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides))
  } catch {
    // A private window without storage keeps the defaults; nothing breaks.
  }
  for (const listener of listeners) listener()
}

export function useKeybindOverrides(): KeybindOverrides {
  return useSyncExternalStore(subscribe, read, () => EMPTY)
}

/** A registry with the artist's keybinds laid over its defaults. */
export function useBoundRegistry<Context>(
  defaults: Registry<Context>
): Registry<Context> {
  const overrides = useKeybindOverrides()
  return useMemo(
    () => applyOverrides(defaults, overrides),
    [defaults, overrides]
  )
}
