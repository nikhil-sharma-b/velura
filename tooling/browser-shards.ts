/**
 * Splits the browser specs into CI's shards by how long they take.
 *
 *   bun tooling/browser-shards.ts <shard> <total>
 *   bun tooling/browser-shards.ts weigh <log>...
 *
 * The first prints the specs of one shard, for `playwright test` to be given.
 * The second rewrites the weights the split is made from,
 * `tests/browser/shard-weights.json`, out of the logs of a CI run's browser
 * jobs (`gh run view <run> --log`): the list reporter prints each test with
 * the time it took. A spec the weights do not name is still run, weighed as
 * the mean of the rest, so the weights only need making again when the
 * shards have drifted apart.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

import { shardOf, weighFromLog, type Weights } from "./browser-shards/split"

const ROOT = resolve(import.meta.dirname, "..")
const SPECS = "tests/browser"
const WEIGHTS = join(ROOT, SPECS, "shard-weights.json")

const [first, ...rest] = process.argv.slice(2)

if (first === "weigh") {
  if (rest.length === 0) throw new Error("Give the logs to weigh from.")
  const weights: Weights = {}
  for (const path of rest)
    for (const [file, seconds] of Object.entries(
      weighFromLog(readFileSync(path, "utf8"))
    ))
      weights[file] = Math.round(((weights[file] ?? 0) + seconds) * 10) / 10
  const sorted = Object.fromEntries(
    Object.entries(weights).sort(([a], [b]) => a.localeCompare(b))
  )
  writeFileSync(WEIGHTS, JSON.stringify(sorted, null, 2) + "\n")
  console.log(`Weighed ${Object.keys(sorted).length} specs.`)
} else {
  const files = readdirSync(join(ROOT, SPECS)).filter((file) =>
    file.endsWith(".spec.ts")
  )
  const weights: Weights = JSON.parse(readFileSync(WEIGHTS, "utf8"))
  const shard = shardOf(files, weights, Number(first), Number(rest[0]))
  console.log(shard.map((file) => `${SPECS}/${file}`).join("\n"))
}
