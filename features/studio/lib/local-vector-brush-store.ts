"use client"

import { useSyncExternalStore } from "react"
import { parseVectorBrush, type VectorBrush } from "@/engine/brush/vector-brush"
import type { VectorBrushLibrary, VectorBrushStore } from "./vector-brush-store"

const KEY = "velura.vector-brushes"
type KeyValueStorage = Pick<Storage, "getItem" | "setItem">
export function createLocalVectorBrushes(storage?: KeyValueStorage) {
  let brushes: VectorBrush[] = []
  try {
    const saved: unknown = JSON.parse(storage?.getItem(KEY) ?? "[]")
    if (Array.isArray(saved))
      brushes = saved.flatMap((value) => {
        try {
          return [parseVectorBrush(value)]
        } catch {
          return []
        }
      })
  } catch {
    /* Unreadable browser storage is an empty library. */
  }
  let state: VectorBrushLibrary = { brushes, loaded: true }
  const listeners = new Set<() => void>()
  function commit(brushes: readonly VectorBrush[]) {
    state = { brushes, loaded: true }
    try {
      storage?.setItem(KEY, JSON.stringify(brushes))
    } catch {
      /* Keep session edits if storage is full. */
    }
    for (const listener of listeners) listener()
  }
  return {
    read: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    async save(brush: VectorBrush) {
      if (state.brushes.length >= 500)
        throw new Error("A library holds at most 500 vector brushes.")
      const id = crypto.randomUUID()
      commit([...state.brushes, parseVectorBrush({ ...brush, id })])
      return id
    },
    async update(id: string, brush: VectorBrush) {
      const next = parseVectorBrush({ ...brush, id })
      commit(state.brushes.map((b) => (b.id === id ? next : b)))
    },
    async rename(id: string, name: string) {
      const brush = state.brushes.find((b) => b.id === id)
      if (brush) {
        const renamed = parseVectorBrush({ ...brush, name })
        commit(state.brushes.map((b) => (b.id === id ? renamed : b)))
      }
    },
    async remove(id: string) {
      commit(state.brushes.filter((b) => b.id !== id))
    },
  }
}
export function createLocalVectorBrushStore(
  storage?: KeyValueStorage
): VectorBrushStore {
  if (!storage) {
    try {
      storage = globalThis.localStorage
    } catch {
      /* Storage may be disabled. */
    }
  }
  const local = createLocalVectorBrushes(storage)
  return {
    ...local,
    useVectorBrushLibrary: () =>
      useSyncExternalStore(local.subscribe, local.read, local.read),
  }
}
