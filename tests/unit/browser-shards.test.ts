import { describe, expect, test } from "bun:test"

import { shardOf, weighFromLog } from "../../tooling/browser-shards/split"

const sum = (files: string[], weights: Record<string, number>) =>
  files.reduce((total, file) => total + weights[file], 0)

describe("splitting the browser specs into shards", () => {
  const weights = {
    "a.spec.ts": 10,
    "b.spec.ts": 200,
    "c.spec.ts": 190,
    "d.spec.ts": 100,
    "e.spec.ts": 60,
    "f.spec.ts": 40,
  }
  const files = Object.keys(weights)

  test("every spec is in one shard and no other", () => {
    const shards = [1, 2, 3].map((index) => shardOf(files, weights, index, 3))
    expect(shards.flat().sort()).toEqual(files)
  })

  test("the shards weigh the same where the specs allow it", () => {
    const shards = [1, 2, 3].map((index) => shardOf(files, weights, index, 3))
    expect(shards.map((shard) => sum(shard, weights))).toEqual([200, 200, 200])
  })

  test("specs that sort together are not kept together", () => {
    // Split by count, the two heaviest would share the first shard.
    const first = shardOf(files, weights, 1, 3)
    expect(first).toContain("b.spec.ts")
    expect(first).not.toContain("c.spec.ts")
  })

  test("the order the specs are listed in does not move them", () => {
    const reversed = [...files].reverse()
    for (const index of [1, 2, 3])
      expect(shardOf(reversed, weights, index, 3)).toEqual(
        shardOf(files, weights, index, 3)
      )
  })

  test("a spec with no weight is taken to weigh what the others do on average", () => {
    // Two unweighed specs at the mean of 100 each: one to a shard, not both
    // to the same one as they would be at no weight.
    const known = { "a.spec.ts": 100, "b.spec.ts": 100 }
    const all = ["a.spec.ts", "b.spec.ts", "new.spec.ts", "newer.spec.ts"]
    const shards = [1, 2].map((index) => shardOf(all, known, index, 2))
    expect(shards.map((shard) => shard.length)).toEqual([2, 2])
    expect(shards[0]).not.toEqual(
      expect.arrayContaining(["new.spec.ts", "newer.spec.ts"])
    )
  })

  test("a shard that is not one of the total is refused", () => {
    expect(() => shardOf(files, weights, 0, 3)).toThrow()
    expect(() => shardOf(files, weights, 4, 3)).toThrow()
  })
})

describe("weighing the specs from a list reporter's log", () => {
  test("a spec weighs the seconds its tests took, however the log prefixes a line", () => {
    const log = [
      "2026-10-13T11:44:22Z   ✓    1 tests/browser/a.spec.ts:10:1 › one (1.5s)",
      "browser (2)\tRun\t2026-10-13T11:44:23Z   ✓    2 tests/browser/a.spec.ts:20:1 › two (500ms)",
      "  ✓    3 tests/browser/b.spec.ts:5:3 › three (took a while) (1.2m)",
      "Running 3 tests using 2 workers",
    ].join("\n")
    expect(weighFromLog(log)).toEqual({ "a.spec.ts": 2, "b.spec.ts": 72 })
  })

  test("a test that failed and was run again is weighed each time it ran", () => {
    const log = [
      "  ✘    1 tests/browser/a.spec.ts:10:1 › one (30.0s)",
      "  ✓    2 tests/browser/a.spec.ts:10:1 › one (retry #1) (4.0s)",
    ].join("\n")
    expect(weighFromLog(log)).toEqual({ "a.spec.ts": 34 })
  })
})
