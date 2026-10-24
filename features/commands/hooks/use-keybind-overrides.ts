"use client"

import { useMemo, useSyncExternalStore } from "react"

import {
  applyOverrides,
  parseOverrides,
  type KeybindOverrides,
} from "../lib/overrides"
import type { Registry } from "../lib/registry"

const STORAGE_KEY = "velura.keybinds"
// Present while the cache mirrors an account rather than holding overrides
// made signed out, so only the latter are ever claimed into an account: a
// stale mirror claimed back would resurrect a reset made on another machine.
const ACCOUNT_KEY = "velura.keybinds.account"
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

type Sink = (overrides: KeybindOverrides) => unknown

// Where the artist's own edits go beyond this device; set while signed in.
let sink: Sink | null = null

function store(overrides: KeybindOverrides, account: boolean) {
  try {
    if (Object.keys(overrides).length === 0)
      localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides))
    if (account) localStorage.setItem(ACCOUNT_KEY, "1")
    else localStorage.removeItem(ACCOUNT_KEY)
  } catch {
    // A private window without storage keeps the defaults; nothing breaks.
  }
  for (const listener of listeners) listener()
}

/**
 * Stores the artist's keybind overrides on this device and tells every
 * reader; signed in, sends them on to the account too. The device copy is
 * written first so the new chord works this keystroke, not a round trip later.
 */
export function writeKeybindOverrides(overrides: KeybindOverrides) {
  store(overrides, sink !== null)
  sink?.(overrides)
}

/** Routes the artist's edits to their account; null when signed out. */
export function setKeybindSink(next: Sink | null) {
  sink = next
}

/** Mirrors the account's overrides onto this device, without echoing them back. */
export function cacheAccountKeybinds(overrides: KeybindOverrides) {
  store(overrides, true)
}

/**
 * Drops the account's mirror at sign-out, so the next person on this machine
 * neither paints with those shortcuts nor claims them into their own account.
 * Overrides made signed out are this device's own and stay.
 */
export function forgetAccountKeybinds() {
  try {
    if (localStorage.getItem(ACCOUNT_KEY) === null) return
  } catch {
    return
  }
  store(EMPTY, false)
}

/** Overrides made on this device while signed out, not yet in any account. */
export function readAnonymousKeybinds(): KeybindOverrides {
  try {
    if (localStorage.getItem(ACCOUNT_KEY) !== null) return EMPTY
  } catch {
    return EMPTY
  }
  return read()
}

/** The artist's keybind overrides on this device, kept current as they change. */
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
