"use client"

import { useMemo, useSyncExternalStore } from "react"

import {
  DEFAULT_BRUSH_SET,
  MAX_BRUSHES,
  nextOrderIn,
  normaliseBrushDefinition,
  normaliseBrushName,
  normaliseSetName,
  normaliseStoredTexture,
  normaliseTextureName,
  reorderBrushes,
} from "@/convex/lib/brush"
import type { Brush } from "@/engine/brush/brush"
import type { GrayscaleTexture } from "@/engine/brush/texture"

import type {
  BrushLibraryState,
  BrushStore,
  LastUsedBrush,
  StoredBrush,
  StoredTexture,
} from "./brush-store"

const STORAGE_KEY = "velura.brushes"

/** The slice of `Storage` this needs, so a test can stand one up in a Map. */
type KeyValueStorage = Pick<Storage, "getItem" | "setItem">

/**
 * Brushes for a session with no account: the same rules as the backend
 * (`convex/lib/brush.ts`), kept in this browser.
 *
 * They do not follow the artist to another machine — nothing anonymous does —
 * but they survive a reload, which is what makes a brush worth shaping before
 * signing in; `brush-migration.ts` is what carries them into the account when
 * one is made.
 */
export function createLocalBrushes(storage: KeyValueStorage) {
  let state = read(storage)
  const listeners = new Set<() => void>()
  let lastUsedByDocument = readLastUsed(storage)

  function commit(next: Omit<BrushLibraryState, "lastUsed" | "loaded">) {
    // Kept in the artist's order, as the account-backed store's `list` is:
    // a panel reading either one groups by set and finds each already
    // arranged, rather than sorting in one host and not the other.
    state = Object.freeze({ ...state, ...next, brushes: byOrder(next.brushes) })
    try {
      storage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          brushes: state.brushes,
          textures: state.textures.map(writeTexture),
          lastUsed: lastUsedByDocument,
        })
      )
    } catch {
      // A browser that refuses the write (private mode, a full quota) costs
      // the artist persistence, not the brush in their hand right now.
    }
    for (const listener of listeners) listener()
  }

  return {
    read: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    lastUsed: (documentId: string): LastUsedBrush | null =>
      lastUsedByDocument[documentId] ?? null,
    async save(name: string, set: string, brush: Brush) {
      if (state.brushes.length >= MAX_BRUSHES)
        throw new Error(`A library holds at most ${MAX_BRUSHES} brushes.`)
      const id = crypto.randomUUID()
      const shelf = normaliseSetName(set)
      const order = nextOrderIn(state.brushes, shelf)
      commit({
        brushes: [
          ...state.brushes,
          {
            id,
            name: normaliseBrushName(name),
            set: shelf,
            order,
            brush: normaliseBrushDefinition(brush),
          },
        ],
        textures: state.textures,
      })
      return id
    },
    async update(id: string, brush: Brush) {
      const definition = normaliseBrushDefinition(brush)
      commit({
        brushes: state.brushes.map((existing) =>
          existing.id === id ? { ...existing, brush: definition } : existing
        ),
        textures: state.textures,
      })
    },
    async rename(id: string, name: string) {
      commit({
        brushes: state.brushes.map((existing) =>
          existing.id === id
            ? { ...existing, name: normaliseBrushName(name) }
            : existing
        ),
        textures: state.textures,
      })
    },
    async remove(id: string) {
      commit({
        brushes: state.brushes.filter((existing) => existing.id !== id),
        textures: state.textures,
      })
    },
    async move(id: string, set: string, index: number) {
      const changes = reorderBrushes(state.brushes, id, set, index)
      const moved = new Map(changes.map((change) => [change.id, change]))
      commit({
        brushes: state.brushes.map((existing) => {
          const change = moved.get(existing.id)
          return change
            ? { ...existing, set: change.set, order: change.order }
            : existing
        }),
        textures: state.textures,
      })
    },
    async saveTexture(name: string, texture: GrayscaleTexture) {
      const id = crypto.randomUUID()
      const stored = normaliseStoredTexture({
        width: texture.width,
        height: texture.height,
        data: texture.data,
      })
      commit({
        brushes: state.brushes,
        textures: [
          ...state.textures,
          { id, name: normaliseTextureName(name), texture: stored },
        ],
      })
      return id
    },
    async recordLastUsed(documentId: string, brushId: string, radius: number) {
      lastUsedByDocument = {
        ...lastUsedByDocument,
        [documentId]: { brushId, radius },
      }
      commit({ brushes: state.brushes, textures: state.textures })
    },
    /** Drops the brushes that have been carried into an account (22/25). */
    keepOnly(brushes: readonly StoredBrush[]) {
      commit({ brushes, textures: state.textures })
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

/**
 * Bytes as text, because `localStorage` holds strings. Base64 rather than an
 * array of numbers: a 256-square paper is 65,536 texels, which as JSON digits
 * and commas is several times the size of the pixels themselves.
 */
function encodeBytes(data: Uint8Array): string {
  let binary = ""
  for (const byte of data) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function decodeBytes(text: string): Uint8Array {
  const binary = atob(text)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function writeTexture(texture: StoredTexture) {
  return {
    id: texture.id,
    name: texture.name,
    width: texture.texture.width,
    height: texture.texture.height,
    data: encodeBytes(texture.texture.data),
  }
}

function readStored(storage: KeyValueStorage): Record<string, unknown> {
  try {
    const stored = storage.getItem(STORAGE_KEY)
    const parsed: unknown = stored ? JSON.parse(stored) : {}
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    // Storage is shared with whatever else this origin has ever written and
    // with older versions of this app: unreadable is empty, never a crash on
    // the way into the studio.
    return {}
  }
}

function read(storage: KeyValueStorage): BrushLibraryState {
  const stored = readStored(storage)
  return Object.freeze({
    brushes: byOrder(readBrushes(stored.brushes)),
    textures: readTextures(stored.textures),
    // Which document was left with which brush is answered per document by
    // `lastUsed`, so the shared state carries none of them.
    lastUsed: null,
    loaded: true,
  })
}

/** The shelf order: within a set, what `reorderBrushes` numbered. */
function byOrder(brushes: readonly StoredBrush[]): StoredBrush[] {
  return [...brushes].sort((a, b) => a.order - b.order)
}

function readBrushes(value: unknown): StoredBrush[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry: unknown) => {
    const stored = entry as Partial<StoredBrush>
    if (typeof stored?.id !== "string") return []
    try {
      return [
        {
          id: stored.id,
          name: normaliseBrushName(stored.name ?? ""),
          set: normaliseSetName(stored.set ?? DEFAULT_BRUSH_SET),
          order: Number.isFinite(stored.order) ? Number(stored.order) : 0,
          // A definition written by an older version of this app is input like
          // any other: one that no longer parses is dropped rather than
          // handed to the engine.
          brush: normaliseBrushDefinition(stored.brush),
        },
      ]
    } catch {
      return []
    }
  })
}

function readTextures(value: unknown): StoredTexture[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry: unknown) => {
    const stored = entry as Record<string, unknown>
    if (typeof stored?.id !== "string" || typeof stored.data !== "string")
      return []
    try {
      return [
        {
          id: stored.id,
          name: normaliseTextureName(String(stored.name ?? "")),
          texture: normaliseStoredTexture({
            width: Number(stored.width),
            height: Number(stored.height),
            data: decodeBytes(stored.data),
          }),
        },
      ]
    } catch {
      return []
    }
  })
}

function readLastUsed(storage: KeyValueStorage): Record<string, LastUsedBrush> {
  const stored = readStored(storage).lastUsed
  if (typeof stored !== "object" || stored === null) return {}
  const entries = Object.entries(stored as Record<string, unknown>).flatMap(
    ([documentId, value]) => {
      const last = value as Partial<LastUsedBrush>
      return typeof last?.brushId === "string" &&
        Number.isFinite(last.radius) &&
        Number(last.radius) > 0
        ? [[documentId, { brushId: last.brushId, radius: Number(last.radius) }]]
        : []
    }
  )
  return Object.fromEntries(entries) as Record<string, LastUsedBrush>
}

/** Wraps the browser-local brushes in the store shape the panel consumes. */
export function createLocalBrushStore(
  storage: KeyValueStorage | undefined = globalThis.localStorage
): BrushStore {
  // Server rendering has no storage, and a browser can refuse it outright.
  // A store with nowhere to write still works for the length of the session.
  const local = createLocalBrushes(storage ?? memoryStorage())
  return {
    useBrushLibrary(documentId?: string) {
      const state = useSyncExternalStore(
        local.subscribe,
        local.read,
        local.read
      )
      return useMemo(
        () => ({
          ...state,
          lastUsed: documentId ? local.lastUsed(documentId) : null,
        }),
        [state, documentId]
      )
    },
    save: local.save,
    update: local.update,
    rename: local.rename,
    remove: local.remove,
    move: local.move,
    saveTexture: local.saveTexture,
    recordLastUsed: local.recordLastUsed,
  }
}
