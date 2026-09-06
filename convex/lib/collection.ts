/**
 * The rule the orphan sweep decides by (D17, §9.4).
 *
 * Every edit writes a new immutable tile, so the tile it replaced is orphaned
 * the moment the flush lands. Reclaiming that space is mark-and-sweep rather
 * than refcounting: a count is a second source of truth that concurrent
 * flushes can corrupt, and a corrupted count deletes pixels. A sweep derives
 * liveness from the rows that already exist, so it is self-healing — a run
 * that decided wrongly is corrected by the next one, because it recomputes
 * from scratch rather than from its own previous answer.
 *
 * The decision lives here, apart from R2 and from Convex, because it is the
 * part that permanently destroys user data and so is the part that has to be
 * exhaustively provable in a test.
 */

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * How long an unreferenced object is left alone before it may be collected.
 *
 * This is what protects an upload still in flight. Between the presigned PUT
 * landing in R2 and `tiles.commitFlush` naming the hash, the object exists and
 * *nothing* references it — it is indistinguishable, by reference alone, from
 * a tile painted over an hour ago. Only its age tells the two apart, so the
 * window is sized for the worst client rather than the typical one: a tab that
 * uploaded, went offline mid-flush, and comes back days later.
 */
export const GRACE_WINDOW_MS = 7 * DAY_MS

/** One object as R2 lists it: the hash its key names, its size, its mtime. */
export type StoredTileObject = {
  readonly hash: string
  readonly size: number
  readonly uploadedAt: number
}

/**
 * The marked set: every hash something still points at.
 *
 * Both sources are walked because they are independently authoritative. A tile
 * row says "the document looks like this now"; a retained restore point says
 * "the document looked like this then", and §9.4 promises that then is still
 * reachable. A hash named by either — or by both — survives.
 */
export function referencedHashesOf(
  tiles: readonly { readonly hash: string }[],
  versions: readonly { readonly tiles: readonly { readonly hash: string }[] }[]
): Set<string> {
  const referenced = new Set<string>()
  for (const tile of tiles) referenced.add(tile.hash)
  for (const version of versions)
    for (const tile of version.tiles) referenced.add(tile.hash)
  return referenced
}

/** What one listed page comes to: what may go, and what the window held. */
export type PagePlan = {
  collect: StoredTileObject[]
  /** Unreferenced objects the grace window saved — the in-flight ones. */
  retainedInGrace: number
}

/**
 * What this run may do with one page: delete an object only if it is
 * unreferenced *and* older than the grace window. Both conditions, never
 * either.
 *
 * One pass states the rule once. The two outcomes are counted together rather
 * than derived from each other because the count is the only evidence anyone
 * has afterwards that the window did its job, and a subtraction between two
 * separately computed filters could disagree with the deletion it describes.
 *
 * Pure and order-preserving, which is what makes the sweep safe to interrupt:
 * a partly applied plan is a prefix of the whole one, and the next run
 * recomputes the rest from the same rules.
 */
export function planPage(
  objects: readonly StoredTileObject[],
  referenced: ReadonlySet<string>,
  now: number,
  graceMs: number = GRACE_WINDOW_MS
): PagePlan {
  const collect: StoredTileObject[] = []
  let retainedInGrace = 0
  for (const object of objects) {
    if (referenced.has(object.hash)) continue
    if (now - object.uploadedAt > graceMs) collect.push(object)
    else retainedInGrace += 1
  }
  return { collect, retainedInGrace }
}

/** Total bytes a set of collected objects gives back, for the run report. */
export function reclaimedBytes(
  objects: readonly { readonly size: number }[]
): number {
  return objects.reduce((total, object) => total + object.size, 0)
}

/**
 * The store the sweep reclaims from, as the sweep needs it. R2 in production
 * and an in-memory double in the tests, because the loop below is the code
 * that actually destroys pixels and so is the code that must be exercised.
 */
export type TileObjectPage = {
  objects: StoredTileObject[]
  /** Absent once the listing is exhausted. */
  cursor: string | undefined
}

export type TileObjectStore = {
  listPage(cursor: string | undefined): Promise<TileObjectPage>
  deleteObjects(hashes: readonly string[]): Promise<void>
}

/** The bookkeeping side: what is reachable, and where the run is written. */
export type CollectionLedger = {
  markedHashes(): Promise<ReadonlySet<string>>
  /** Drops the dedup ledger rows for a batch, before its bytes are deleted. */
  forgetCollected(hashes: readonly string[]): Promise<void>
  /** Adds a retired batch to the run report, after its bytes are deleted. */
  recordCollected(batch: {
    collected: readonly StoredTileObject[]
    scanned: number
    retainedInGrace: number
  }): Promise<void>
}

export type SweepOptions = {
  now?: () => number
  graceMs?: number
}

/**
 * One sweep: page through the store, mark, delete what neither a document nor
 * a retained restore point still names, and retire each page before listing
 * the next.
 *
 * The mark is re-read per page rather than once at the start. A flush can
 * adopt an existing hash without re-uploading it — that is what the dedup
 * check in `tiles.missingHashes` is for — so an object that was unreferenced
 * when the run began may have gained a reference since, and a mark taken at
 * the start would not know. Reading it later than the listing means every
 * reference written before this moment is honoured.
 *
 * Forgetting comes before deleting, and the order is the whole safety
 * argument. `blobs` is what `tiles.missingHashes` answers from, so a row that
 * outlives its object tells every later client "already uploaded" — the tile
 * is never re-sent, the flush commits a row pointing at nothing, and no future
 * sweep revisits the object because R2 no longer lists it. Dropping the row
 * first makes an interruption harmless instead: the bytes become an orphan
 * with no row, which is precisely what the next run knows how to collect.
 */
export async function runSweep(
  store: TileObjectStore,
  ledger: CollectionLedger,
  { now = Date.now, graceMs = GRACE_WINDOW_MS }: SweepOptions = {}
): Promise<void> {
  let cursor: string | undefined = undefined
  do {
    const page = await store.listPage(cursor)
    cursor = page.cursor

    const marked = await ledger.markedHashes()
    const plan = planPage(page.objects, marked, now(), graceMs)

    const hashes = plan.collect.map((object) => object.hash)
    await ledger.forgetCollected(hashes)
    await store.deleteObjects(hashes)
    await ledger.recordCollected({
      collected: plan.collect,
      scanned: page.objects.length,
      retainedInGrace: plan.retainedInGrace,
    })
  } while (cursor !== undefined)
}
