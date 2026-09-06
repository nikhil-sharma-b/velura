import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

/**
 * D30 forbids CPU readback in the interactive path outright. Two calls are
 * sanctioned exceptions, both asynchronous and neither per frame: `readPixels`
 * for export and previews, and the renderer's `readTiles`, which is how an
 * undo entry learns what a finished mark left behind (D21). The rule is
 * checkable as a fact about the source: nothing else in the engine may name
 * the calls that move pixels back across the bus, and neither exception may
 * leak the calls into the module around it.
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

/**
 * The one function in each module allowed to name them, and the line that
 * closes it. Bounded at both ends: a slice that ran to the end of the file
 * would wave through any readback introduced below the exception.
 */
const SANCTIONED = {
  "index.ts": { from: "async readPixels()", to: "    dispose() {" },
  "gpu/renderer.ts": {
    from: "async readTiles(",
    to: "    writeTiles(id, tiles) {",
  },
} as const

describe("the interactive path never reads pixels back", () => {
  const engine = join(import.meta.dir, "..", "..", "engine")
  const sanctioned = Object.keys(SANCTIONED).map((path) =>
    join(engine, ...path.split("/"))
  )

  test("no engine module but the two sanctioned ones names a readback call", () => {
    const offenders = sources(engine)
      .filter((path) => !sanctioned.includes(path))
      .filter((path) => {
        const source = readFileSync(path, "utf8")
        return READBACK.some((call) => source.includes(call))
      })
    expect(offenders).toEqual([])
  })

  test.each(Object.entries(SANCTIONED))(
    "%s reads back only inside its one sanctioned function",
    (path, bounds) => {
      const source = readFileSync(join(engine, ...path.split("/")), "utf8")
      const start = source.indexOf(bounds.from)
      const end = source.indexOf(bounds.to, start)
      // A renamed or reordered function must fail here rather than quietly
      // widen the exception to the whole file.
      expect({ path, start: start > -1, end: end > start }).toEqual({
        path,
        start: true,
        end: true,
      })
      const exception = source.slice(start, end)
      for (const call of READBACK) {
        const total = source.split(call).length - 1
        const inside = exception.split(call).length - 1
        expect({ call, outside: total - inside }).toEqual({ call, outside: 0 })
      }
    }
  )
})
