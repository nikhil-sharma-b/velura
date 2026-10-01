"use client"

import { useSyncExternalStore } from "react"

/**
 * Whether the rulers are shown (08): an app preference, kept the way the
 * keybind overrides are. This device's copy is what the studio reads, so the
 * rulers are as they were left from the first frame; signed in, each choice
 * also goes to the account, and the account's copy replaces this one when it
 * arrives.
 */

const STORAGE_KEY = "velura.rulers"
// Present while the stored choice mirrors an account rather than being one
// made signed out, as for the keybinds: only the latter is ever claimed into
// an account, so one artist's choice never lands in the next one's.
const ACCOUNT_KEY = "velura.rulers.account"

const listeners = new Set<() => void>()

export function readRulersVisible(): boolean {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "false") === true
  } catch {
    // Storage that cannot be read, or holds nonsense, is no rulers.
    return false
  }
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

function store(visible: boolean | null, account: boolean) {
  try {
    if (visible === null) localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(visible))
    if (account) localStorage.setItem(ACCOUNT_KEY, "1")
    else localStorage.removeItem(ACCOUNT_KEY)
  } catch {
    // A private window without storage forgets it at reload; nothing breaks.
  }
  for (const listener of listeners) listener()
}

type Sink = (visible: boolean) => unknown

// Where the artist's choices go beyond this device; set while signed in.
let sink: Sink | null = null

/** Shows or hides the rulers from now on, here and, signed in, everywhere. */
export function writeRulersVisible(visible: boolean) {
  store(visible, sink !== null)
  sink?.(visible)
}

/** Routes the artist's choices to their account; null when signed out. */
export function setRulersSink(next: Sink | null) {
  sink = next
}

/** Mirrors the account's choice onto this device, without echoing it back. */
export function cacheAccountRulers(visible: boolean) {
  store(visible, true)
}

/**
 * Drops the account's choice at sign-out, so the next person on this machine
 * neither sees it nor claims it; a choice made signed out is this device's
 * own and stays.
 */
export function forgetAccountRulers() {
  try {
    if (localStorage.getItem(ACCOUNT_KEY) === null) return
  } catch {
    return
  }
  store(null, false)
}

/** A choice made on this device while signed out, if there is one. */
export function readAnonymousRulers(): boolean | null {
  try {
    if (localStorage.getItem(ACCOUNT_KEY) !== null) return null
    if (localStorage.getItem(STORAGE_KEY) === null) return null
  } catch {
    return null
  }
  return readRulersVisible()
}

/** The preference, kept current as it changes here or in another tab. */
export function useRulersVisible(): boolean {
  return useSyncExternalStore(subscribe, readRulersVisible, () => false)
}
