"use node"

import {
  deleteAssetObjects,
  deleteTileObjects,
  listAssetObjects,
  listTileObjects,
} from "./lib/r2"
import { runSweep } from "./lib/collection"
import { internalAction } from "./_generated/server"
import { internal } from "./_generated/api"

/**
 * The nightly sweep (D17, §9.4), wired up: R2 as the object store, Convex as
 * the ledger. The loop itself is `lib/collection.ts`'s `runSweep`, where it
 * runs against an in-memory bucket — this is the code that permanently deletes
 * an artist's pixels, so it is tested rather than merely reviewed.
 *
 * R2's listing, not the `blobs` ledger, is what gets walked: an upload whose
 * flush never committed has bytes in the bucket and no row anywhere, and it is
 * exactly that object the ledger cannot see and the grace window must protect.
 */
export const sweep = internalAction({
  args: {},
  handler: async (ctx) => {
    const runId = await ctx.runMutation(internal.collection.beginRun, {})

    await runSweep(
      { listPage: listTileObjects, deleteObjects: deleteTileObjects },
      {
        markedHashes: async () =>
          new Set([
            ...(await allPages((cursor) =>
              ctx.runQuery(internal.collection.markedTileHashes, { cursor })
            )),
            ...(await allPages((cursor) =>
              ctx.runQuery(internal.collection.markedVersionHashes, { cursor })
            )),
          ]),
        forgetCollected: async (hashes) => {
          await ctx.runMutation(internal.collection.forgetCollected, {
            hashes: [...hashes],
          })
        },
        recordCollected: async ({ collected, scanned, retainedInGrace }) => {
          await ctx.runMutation(internal.collection.recordCollected, {
            runId,
            collected: collected.map((object) => ({
              hash: object.hash,
              size: object.size,
            })),
            scanned,
            retainedInGrace,
          })
        },
      }
    )

    // The originals placed images keep are swept the same way and in the same
    // run, against their own mark: a photograph no document and no retained
    // restore point still names is as collectable as a painted-over tile, and
    // leaving it would grow the bucket in a way nothing ever shrinks.
    await runSweep(
      { listPage: listAssetObjects, deleteObjects: deleteAssetObjects },
      {
        markedHashes: async () =>
          new Set([
            ...(await allPages((cursor) =>
              ctx.runQuery(internal.collection.markedDocumentAssetIds, {
                cursor,
              })
            )),
            ...(await allPages((cursor) =>
              ctx.runQuery(internal.collection.markedVersionAssetIds, {
                cursor,
              })
            )),
          ]),
        forgetCollected: async (hashes) => {
          await ctx.runMutation(internal.collection.forgetCollected, {
            hashes: [...hashes],
          })
        },
        recordCollected: async ({ collected, scanned, retainedInGrace }) => {
          await ctx.runMutation(internal.collection.recordCollected, {
            runId,
            collected: collected.map((object) => ({
              hash: object.hash,
              size: object.size,
            })),
            scanned,
            retainedInGrace,
          })
        },
      }
    )

    // Only on the way out: a run that threw part-way leaves its counters
    // behind with no `finishedAt`, which is how an interrupted sweep is told
    // apart from one that saw the whole bucket.
    await ctx.runMutation(internal.collection.finishRun, { runId })
  },
})

/** Drains a cursor-paged mark query into one list of hashes. */
async function allPages(
  page: (
    cursor: string | null
  ) => Promise<{ hashes: string[]; cursor: string | null }>
): Promise<string[]> {
  const hashes: string[] = []
  let cursor: string | null = null
  do {
    const result = await page(cursor)
    hashes.push(...result.hashes)
    cursor = result.cursor
  } while (cursor !== null)
  return hashes
}
