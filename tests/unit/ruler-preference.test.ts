import { afterAll, beforeEach, describe, expect, test } from "bun:test"

import {
  cacheAccountRulers,
  forgetAccountRulers,
  readAnonymousRulers,
  readRulersVisible,
  setRulersSink,
  writeRulersVisible,
} from "../../features/studio/lib/ruler-preference"

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
  setRulersSink(null)
})

describe("ruler preference", () => {
  test("is off until chosen", () => {
    expect(readRulersVisible()).toBe(false)
  })

  test("a choice is kept on this device, as a reload would read it", () => {
    writeRulersVisible(true)
    expect(readRulersVisible()).toBe(true)
    writeRulersVisible(false)
    expect(readRulersVisible()).toBe(false)
  })

  test("signed in, a choice also goes to the account", () => {
    const sent: boolean[] = []
    setRulersSink((visible) => sent.push(visible))
    writeRulersVisible(true)
    expect(sent).toEqual([true])
  })

  test("the account's choice is mirrored here without being sent back", () => {
    const sent: boolean[] = []
    setRulersSink((visible) => sent.push(visible))
    cacheAccountRulers(true)
    expect(readRulersVisible()).toBe(true)
    expect(sent).toEqual([])
  })

  test("a choice made signed out is claimable; a mirrored or sent one is not", () => {
    writeRulersVisible(true)
    expect(readAnonymousRulers()).toBe(true)
    cacheAccountRulers(true)
    expect(readAnonymousRulers()).toBeNull()
    setRulersSink(() => {})
    writeRulersVisible(false)
    expect(readAnonymousRulers()).toBeNull()
  })

  test("signing out forgets the account's choice, not this device's own", () => {
    cacheAccountRulers(true)
    forgetAccountRulers()
    expect(readRulersVisible()).toBe(false)
    expect(readAnonymousRulers()).toBeNull()
    writeRulersVisible(true)
    forgetAccountRulers()
    expect(readRulersVisible()).toBe(true)
  })

  test("unreadable storage is no rulers, and nothing breaks", () => {
    entries.set("velura.rulers", "not json")
    expect(readRulersVisible()).toBe(false)
  })
})
