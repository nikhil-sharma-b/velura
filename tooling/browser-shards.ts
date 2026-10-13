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

const ROOT = resolve(import.meta.dir, "..")
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
  // Every file Playwright would take for a test, wherever under the specs
  // it is: one this missed would be run by no shard.
  const files = readdirSync(join(ROOT, SPECS), { recursive: true })
    .map(String)
    .filter((file) => /\.(spec|test)\.[cm]?[jt]sx?$/.test(file))
  const weights: Weights = JSON.parse(readFileSync(WEIGHTS, "utf8"))
  const shard = shardOf(files, weights, Number(first), Number(rest[0]))
  // To the log and not the list: a new spec is dealt as a mean one until
  // it is weighed, which a slow one is not.
  const unweighed = files.filter((file) => weights[file] === undefined)
  if (unweighed.length > 0)
    console.error(`Not weighed yet: ${unweighed.join(", ")}`)
  // Given no specs, Playwright would run them all.
  if (shard.length === 0) throw new Error("There are more shards than specs.")
  console.log(shard.map((file) => `${SPECS}/${file}`).join("\n"))
}
