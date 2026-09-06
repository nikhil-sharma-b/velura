import type { StoredTileObject } from "../../../convex/lib/collection"

/** A stored object as R2 would list it, aged relative to the test's clock. */
export function tileObject(
  hash: string,
  uploadedAt: number,
  size = 100
): StoredTileObject {
  return { hash, size, uploadedAt }
}

/**
 * An in-memory stand-in for the tile bucket. `pageSize` is small so the
 * paging path — the part an interruption lands in — is the one under test.
 */
export function fakeStore(objects: StoredTileObject[], pageSize = 2) {
  const order = objects.map((object) => object.hash)
  const remaining = new Map(objects.map((object) => [object.hash, object]))
  const deleted: string[] = []
  let failAfterDeletes: number | null = null

  return {
    deleted,
    remaining,
    failOnDeleteNumber(count: number) {
      failAfterDeletes = count
    },
    store: {
      async listPage(cursor: string | undefined) {
        // Cursors index the listing order, not the surviving objects, so a
        // page deleted mid-run does not shift the ones behind it — which is
        // how R2's own key-ordered continuation tokens behave.
        const start = cursor === undefined ? 0 : Number(cursor)
        const page: StoredTileObject[] = []
        let index = start
        while (index < order.length && page.length < pageSize) {
          const object = remaining.get(order[index]!)
          if (object !== undefined) page.push(object)
          index += 1
        }
        return {
          objects: page,
          cursor: index < order.length ? String(index) : undefined,
        }
      },
      async deleteObjects(hashes: readonly string[]) {
        if (hashes.length === 0) return
        if (failAfterDeletes !== null && deleted.length >= failAfterDeletes)
          throw new Error("R2 went away mid-sweep")
        for (const hash of hashes) {
          deleted.push(hash)
          remaining.delete(hash)
        }
      },
    },
  }
}

export function fakeLedger(marked: Iterable<string>) {
  const forgotten: string[] = []
  const batches: { scanned: number; retainedInGrace: number }[] = []
  const markedSet = new Set(marked)
  return {
    forgotten,
    batches,
    markedSet,
    ledger: {
      async markedHashes() {
        return markedSet
      },
      async forgetCollected(hashes: readonly string[]) {
        for (const hash of hashes) forgotten.push(hash)
      },
      async recordCollected(batch: {
        collected: readonly StoredTileObject[]
        scanned: number
        retainedInGrace: number
      }) {
        batches.push({
          scanned: batch.scanned,
          retainedInGrace: batch.retainedInGrace,
        })
      },
    },
  }
}
