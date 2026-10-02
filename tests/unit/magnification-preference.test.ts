import { afterAll, beforeEach, describe, expect, test } from "bun:test"

import {
  readRasterMagnification,
  writeRasterMagnification,
} from "../../features/studio/lib/magnification-preference"

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

beforeEach(() => entries.clear())

describe("raster magnification preference", () => {
  test("is pixels when zoomed in until chosen", () => {
    expect(readRasterMagnification()).toBe("pixels")
  })

  test("a choice is kept on this device, as a reload would read it", () => {
    writeRasterMagnification("smooth")
    expect(readRasterMagnification()).toBe("smooth")
    writeRasterMagnification("pixels")
    expect(readRasterMagnification()).toBe("pixels")
  })

  test("anything else stored reads as the default", () => {
    entries.set("velura.magnification", JSON.stringify("blurry"))
    expect(readRasterMagnification()).toBe("pixels")
    entries.set("velura.magnification", "{not json")
    expect(readRasterMagnification()).toBe("pixels")
  })
})
