import { describe, expect, test } from "bun:test"

import {
  claimTabSessionId,
  releaseTabSessionId,
} from "@/features/library/lib/tab-session"

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value),
  }
}

function copyOf(storage: Storage): Storage {
  const copy = memoryStorage()
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i)!
    copy.setItem(key, storage.getItem(key)!)
  }
  return copy
}

let counter = 0
const mint = () => `id-${++counter}`

describe("a tab's session id", () => {
  test("survives a reload of the same tab", () => {
    const storage = memoryStorage()
    const first = claimTabSessionId(storage, mint)
    // A reload fires pagehide before the next load claims.
    releaseTabSessionId(storage)
    expect(claimTabSessionId(storage, mint)).toBe(first)
  })

  test("is not shared with a duplicate of a tab that is still open", () => {
    const storage = memoryStorage()
    const original = claimTabSessionId(storage, mint)
    // Duplicating a tab copies its sessionStorage while it is still live.
    const duplicate = claimTabSessionId(copyOf(storage), mint)
    expect(duplicate).not.toBe(original)
  })

  test("is minted fresh when storage is unavailable", () => {
    const broken = {
      getItem() {
        throw new Error("denied")
      },
      setItem() {
        throw new Error("denied")
      },
      removeItem() {
        throw new Error("denied")
      },
    } as unknown as Storage
    expect(claimTabSessionId(broken, mint)).toMatch(/^id-/)
    expect(() => releaseTabSessionId(broken)).not.toThrow()
  })
})
