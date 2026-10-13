/** The seconds each browser spec's tests take on CI, by file name. */
export type Weights = Record<string, number>

/**
 * The specs of one shard out of `total`, `index` counted from one.
 *
 * Playwright's own `--shard` deals the tests out by count in file order, and
 * the slow specs sort together: the fluid ones, which step a simulation the
 * CI runner rasterizes in software, all fell to one shard. Here the specs
 * are dealt by what they weigh, heaviest first, each to the shard that is
 * lightest so far. A spec with no weight is taken to weigh the mean of those
 * that have one.
 */
export function shardOf(
  files: readonly string[],
  weights: Weights,
  index: number,
  total: number
): string[] {
  if (!Number.isInteger(total) || total < 1)
    throw new Error("The number of shards must be a whole number, one or more.")
  if (!Number.isInteger(index) || index < 1 || index > total)
    throw new Error(`The shard must be a whole number from 1 to ${total}.`)

  const known = files.filter((file) => weights[file] !== undefined)
  const mean =
    known.reduce((sum, file) => sum + weights[file], 0) / (known.length || 1)
  const weigh = (file: string) => weights[file] ?? mean

  const shards = Array.from({ length: total }, () => ({
    weight: 0,
    files: [] as string[],
  }))
  // By name where weights tie, so the split is the same wherever it is made.
  const heaviestFirst = [...files].sort(
    (a, b) => weigh(b) - weigh(a) || a.localeCompare(b)
  )
  for (const file of heaviestFirst) {
    let lightest = shards[0]
    for (const shard of shards)
      if (shard.weight < lightest.weight) lightest = shard
    lightest.weight += weigh(file)
    lightest.files.push(file)
  }
  return shards[index - 1].files.sort()
}

const UNITS = { ms: 0.001, s: 1, m: 60 }
const LISTED =
  /[✓✘]\s+\d+ (?:\[[^\]]+\] › )?tests\/browser\/([^:\s]+):\d+:\d+ › .* \((\d+(?:\.\d+)?)(ms|s|m)\)\s*$/

/**
 * Weights from what Playwright's list reporter printed, as CI's log has it:
 * each spec weighs the seconds its tests took, a retried test each time it
 * ran.
 */
export function weighFromLog(log: string): Weights {
  const weights: Weights = {}
  for (const line of log.split("\n")) {
    const listed = LISTED.exec(line)
    if (!listed) continue
    const [, file, amount, unit] = listed
    const seconds = Number(amount) * UNITS[unit as keyof typeof UNITS]
    weights[file] = (weights[file] ?? 0) + seconds
  }
  for (const file of Object.keys(weights))
    weights[file] = Math.round(weights[file] * 10) / 10
  return weights
}
