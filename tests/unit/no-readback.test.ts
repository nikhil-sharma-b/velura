import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

/**
 * D30 forbids CPU readback in the interactive path outright. `readPixels` is
 * the sanctioned exception — export and previews, asynchronous, never per
 * frame — so the rule is checkable as a fact about the source: nothing else in
 * the engine may name the calls that move pixels back across the bus.
 *
 * The benchmark checks the same claim at runtime by counting those calls while
 * painting; this catches the introduction rather than the consequence.
 */
const READBACK = ["mapAsync", "copyTextureToBuffer", "getMappedRange"]

function sources(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) return sources(path)
    return path.endsWith(".ts") ? [path] : []
  })
}

describe("the interactive path never reads pixels back", () => {
  const engine = join(import.meta.dir, "..", "..", "engine")

  test("no engine module but the entry point names a readback call", () => {
    const offenders = sources(engine)
      .filter((path) => path !== join(engine, "index.ts"))
      .filter((path) => {
        const source = readFileSync(path, "utf8")
        return READBACK.some((call) => source.includes(call))
      })
    expect(offenders).toEqual([])
  })

  test("the entry point reads back only inside readPixels", () => {
    const source = readFileSync(join(engine, "index.ts"), "utf8")
    // Everything from `readPixels` to the end of the object literal it sits in.
    const readPixels = source.slice(source.indexOf("async readPixels()"))
    for (const call of READBACK) {
      const total = source.split(call).length - 1
      const inside = readPixels.split(call).length - 1
      expect({ call, outside: total - inside }).toEqual({ call, outside: 0 })
    }
  })
})
