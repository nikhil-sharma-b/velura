"use client"

import { useSyncExternalStore } from "react"

import {
  moveColor,
  normaliseColors,
  normalisePaletteName,
  normaliseSwatch,
  recordRecent,
} from "@/convex/lib/palette"

import type { PaletteRecord, PaletteState, PaletteStore } from "./palette-store"

const STORAGE_KEY = "velura.palettes"

/** The slice of `Storage` this needs, so a test can stand one up in a Map. */
type KeyValueStorage = Pick<Storage, "getItem" | "setItem">

/**
 * Palettes for a session with no account: the same rules as the backend
 * (`convex/lib/palette.ts`), kept in this browser. They do not follow the
 * artist to another machine — nothing anonymous does — but they do survive a
 * reload, which is what makes a scheme worth building before signing in.
 */
export function createLocalPalettes(storage: KeyValueStorage) {
  let state = read(storage)
  const listeners = new Set<() => void>()

  function commit(next: PaletteState) {
    state = Object.freeze(next)
    try {
      storage.setItem(
        STORAGE_KEY,
        JSON.stringify({ palettes: state.palettes, recent: state.recent })
      )
    } catch {
      // A browser that refuses the write (private mode, a full quota) costs
      // the artist persistence, not the colours they are working with now.
    }
    for (const listener of listeners) listener()
  }

  function patch(
    id: string,
    change: (palette: PaletteRecord) => readonly string[]
  ) {
    const palettes = state.palettes.map((palette) =>
      palette.id === id
        ? { ...palette, colors: normaliseColors(change(palette)) }
        : palette
    )
    commit({ ...state, palettes })
  }

  return {
    read: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    async create(name: string, colors: readonly string[]) {
      const id = crypto.randomUUID()
      commit({
        ...state,
        palettes: [
          ...state.palettes,
          {
            id,
            name: normalisePaletteName(name),
            colors: normaliseColors(colors),
          },
        ],
      })
      return id
    },
    async rename(id: string, name: string) {
      commit({
        ...state,
        palettes: state.palettes.map((palette) =>
          palette.id === id
            ? { ...palette, name: normalisePaletteName(name) }
            : palette
        ),
      })
    },
    async remove(id: string) {
      commit({
        ...state,
        palettes: state.palettes.filter((palette) => palette.id !== id),
      })
    },
    async addColor(id: string, hex: string) {
      patch(id, (palette) => [...palette.colors, hex])
    },
    async removeColorAt(id: string, index: number) {
      patch(id, (palette) => palette.colors.filter((_, at) => at !== index))
    },
    async reorder(id: string, from: number, to: number) {
      patch(id, (palette) => moveColor(palette.colors, from, to))
    },
    /** Drops the palettes that have been carried into an account (23/22). */
    keepOnly(palettes: readonly PaletteRecord[]) {
      commit({ ...state, palettes })
    },
    async recordUsed(hex: string) {
      commit({ ...state, recent: recordRecent(state.recent, hex) })
    },
  }
}

function memoryStorage(): KeyValueStorage {
  const entries = new Map<string, string>()
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => void entries.set(key, value),
  }
}

function read(storage: KeyValueStorage): PaletteState {
  try {
    const stored = storage.getItem(STORAGE_KEY)
    if (!stored)
      return Object.freeze({ palettes: [], recent: [], loaded: true })
    const parsed: unknown = JSON.parse(stored)
    return Object.freeze({
      palettes: readPalettes(parsed),
      recent: readStrings((parsed as { recent?: unknown })?.recent).flatMap(
        (color) => normaliseSwatch(color) ?? []
      ),
      loaded: true,
    })
  } catch {
    // Storage is shared with whatever else this origin has ever written and
    // with older versions of this app: unreadable is empty, never a crash on
    // the way into the studio.
    return Object.freeze({ palettes: [], recent: [], loaded: true })
  }
}

function readStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : []
}

function readPalettes(value: unknown): PaletteRecord[] {
  const palettes = (value as { palettes?: unknown })?.palettes
  if (!Array.isArray(palettes)) return []
  return palettes.flatMap((entry: unknown) => {
    const palette = entry as Partial<PaletteRecord>
    if (typeof palette?.id !== "string" || typeof palette?.name !== "string")
      return []
    return [
      {
        id: palette.id,
        name: palette.name,
        colors: readStrings(palette.colors).flatMap(
          (color) => normaliseSwatch(color) ?? []
        ),
      },
    ]
  })
}

/** Wraps the browser-local palettes in the store shape the picker consumes. */
export function createLocalPaletteStore(
  storage: KeyValueStorage | undefined = globalThis.localStorage
): PaletteStore {
  // Server rendering has no storage, and a browser can refuse it outright.
  // A store with nowhere to write still works for the length of the session.
  const local = createLocalPalettes(storage ?? memoryStorage())
  return {
    usePaletteState: () =>
      useSyncExternalStore(local.subscribe, local.read, local.read),
    create: local.create,
    rename: local.rename,
    remove: local.remove,
    addColor: local.addColor,
    removeColorAt: local.removeColorAt,
    reorder: local.reorder,
    recordUsed: local.recordUsed,
  }
}
