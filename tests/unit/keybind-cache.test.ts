import { afterAll, beforeEach, describe, expect, test } from "bun:test"

import {
  cacheAccountKeybinds,
  forgetAccountKeybinds,
  readAnonymousKeybinds,
  setKeybindSink,
  writeKeybindOverrides,
} from "../../features/commands/hooks/use-keybind-overrides"

const entries = new Map<string, string>()
const original = globalThis.localStorage
afterAll(() => {
  globalThis.localStorage = original
})
globalThis.localStorage = {
  getItem: (key: string) => entries.get(key) ?? null,
  setItem: (key: string, value: string) => void entries.set(key, value),
  removeItem: (key: string) => void entries.delete(key),
} as Storage

beforeEach(() => {
  entries.clear()
  setKeybindSink(null)
})

describe("keybind cache", () => {
  test("overrides made signed out are claimable", () => {
    writeKeybindOverrides({ "tool.brush": ["q"] })
    expect(readAnonymousKeybinds()).toEqual({ "tool.brush": ["q"] })
  })

  test("signed in, edits go to the account and are never claimed again", () => {
    const sent: unknown[] = []
    setKeybindSink((overrides) => sent.push(overrides))
    writeKeybindOverrides({ "tool.brush": ["q"] })
    expect(sent).toEqual([{ "tool.brush": ["q"] }])
    expect(readAnonymousKeybinds()).toEqual({})
  })

  test("a mirrored account is not claimed back, until edited signed out", () => {
    cacheAccountKeybinds({ "tool.brush": ["q"] })
    expect(readAnonymousKeybinds()).toEqual({})
    writeKeybindOverrides({ "tool.brush": ["w"] })
    expect(readAnonymousKeybinds()).toEqual({ "tool.brush": ["w"] })
  })

  test("mirroring the account does not echo it back", () => {
    const sent: unknown[] = []
    setKeybindSink((overrides) => sent.push(overrides))
    cacheAccountKeybinds({ "tool.brush": ["q"] })
    expect(sent).toEqual([])
  })

  test("signing out forgets the account's mirror but keeps local overrides", () => {
    cacheAccountKeybinds({ "tool.brush": ["q"] })
    forgetAccountKeybinds()
    expect(entries.has("velura.keybinds")).toBe(false)
    writeKeybindOverrides({ "tool.brush": ["w"] })
    forgetAccountKeybinds()
    expect(readAnonymousKeybinds()).toEqual({ "tool.brush": ["w"] })
  })
})
