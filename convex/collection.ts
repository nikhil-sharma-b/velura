import { getAuthUserId } from "@convex-dev/auth/server"
import { ConvexError, v } from "convex/values"

import { internalMutation, internalQuery, query } from "./_generated/server"
import {
  reclaimedBytes,
  referencedAssetIdsOf,
  referencedHashesOf,
} from "./lib/collection"
import { PREVIEW_OBJECT_PREFIX } from "./lib/preview_key"

/**
 * The database half of orphan collection (D17, §9.4): the mark, the ledger
 * bookkeeping, and the run report. The R2 half — listing objects and deleting
 * them — lives in `collectionActions.ts`, which cannot run in the Convex
 * runtime; the decision between the two halves lives in `lib/collection.ts`,
 * where it can be tested without either.
 */

/**
 * The mark phase, one page at a time: the tile hashes something still points
 * at, across all owners.
 *
 * Deliberately global rather than per-document. A hash is content-addressed,
 * so the same pixels are one R2 object however many documents painted them;
 * sweeping one document at a time could delete an object a *different*
 * document still names. Reachability is a property of the whole store.
 *
 * Paged rather than collected whole because the mark grows with the whole
 * installation and a Convex query that reads too much throws — and a mark that
 * throws is a sweep that reclaims nothing, every night, silently. A restore
 * point names every tile in its document, so `versions` is read in far smaller
 * bites than `tiles`.
 */
const TILE_PAGE_SIZE = 512
const VERSION_PAGE_SIZE = 32

export const markedTileHashes = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db
      .query("tiles")
      .paginate({ cursor, numItems: TILE_PAGE_SIZE })
    return {
      hashes: [...referencedHashesOf(page.page, [])],
      cursor: page.isDone ? null : page.continueCursor,
    }
  },
})

export const markedVersionHashes = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db
      .query("versions")
      .paginate({ cursor, numItems: VERSION_PAGE_SIZE })
    return {
      hashes: [...referencedHashesOf([], page.page)],
      cursor: page.isDone ? null : page.continueCursor,
    }
  },
})

/**
 * The mark for the originals placed images keep (06): the trees the documents
 * hold now, and the trees their retained restore points hold. A tree is small
 * beside a document's tiles, but there is one per document, so this pages like
 * the others.
 */
const DOCUMENT_PAGE_SIZE = 64

export const markedDocumentAssetIds = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db
      .query("documents")
      .paginate({ cursor, numItems: DOCUMENT_PAGE_SIZE })
    return {
      hashes: [
        ...referencedAssetIdsOf(
          page.page.map((document) => document.structure)
        ),
      ],
      cursor: page.isDone ? null : page.continueCursor,
    }
  },
})

/** Immutable preview objects may be shared by duplicates. */
export const markedPreviewObjectIds = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db
      .query("documents")
      .paginate({ cursor, numItems: DOCUMENT_PAGE_SIZE })
    return {
      hashes: page.page.flatMap((document) =>
        document.previewObjectKey?.startsWith(PREVIEW_OBJECT_PREFIX)
          ? [document.previewObjectKey.slice(PREVIEW_OBJECT_PREFIX.length)]
          : []
      ),
      cursor: page.isDone ? null : page.continueCursor,
    }
  },
})

export const markedVersionAssetIds = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db
      .query("versions")
      .paginate({ cursor, numItems: VERSION_PAGE_SIZE })
    return {
      hashes: [
        ...referencedAssetIdsOf(page.page.map((version) => version.structure)),
      ],
      cursor: page.isDone ? null : page.continueCursor,
    }
  },
})

/** Opens a run report, so an interrupted sweep still leaves its numbers. */
export const beginRun = internalMutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.insert("collectionRuns", {
      startedAt: Date.now(),
      scannedCount: 0,
      collectedCount: 0,
      reclaimedBytes: 0,
      retainedInGraceCount: 0,
    })
  },
})

/**
 * Drops the dedup ledger rows for a batch, *before* its bytes are deleted.
 *
 * That order is the safety argument. `blobs` is what `tiles.missingHashes`
 * answers from, so a row that outlives its object tells every later client the
 * tile is already uploaded: the client skips the PUT, `commitFlush` writes a
 * tile row pointing at nothing, and no future sweep revisits the object
 * because R2 no longer lists it. Dropping the row first makes an interruption
 * harmless instead — the bytes become an orphan with no row, which is exactly
 * what the next run collects.
 */
export const forgetCollected = internalMutation({
  args: { hashes: v.array(v.string()) },
  handler: async (ctx, { hashes }) => {
    for (const hash of hashes) {
      const blob = await ctx.db
        .query("blobs")
        .withIndex("by_hash", (q) => q.eq("hash", hash))
        .unique()
      // Absent is the ordinary case for an object that was never confirmed:
      // an upload whose flush never committed has bytes in R2 and no row. It
      // is also what a replayed batch sees, which is why this is not an error.
      if (blob !== null) await ctx.db.delete(blob._id)
    }
  },
})

/** Adds a retired batch to the run's totals, once its bytes are gone. */
export const recordCollected = internalMutation({
  args: {
    runId: v.id("collectionRuns"),
    collected: v.array(v.object({ hash: v.string(), size: v.number() })),
    scanned: v.number(),
    retainedInGrace: v.number(),
  },
  handler: async (ctx, { runId, collected, scanned, retainedInGrace }) => {
    const run = await ctx.db.get(runId)
    if (run === null) throw new ConvexError("That collection run is gone.")
    await ctx.db.patch(runId, {
      scannedCount: run.scannedCount + scanned,
      collectedCount: run.collectedCount + collected.length,
      reclaimedBytes: run.reclaimedBytes + reclaimedBytes(collected),
      retainedInGraceCount: run.retainedInGraceCount + retainedInGrace,
    })
  },
})

/** Closes the report. A run with no `finishedAt` did not reach the end. */
export const finishRun = internalMutation({
  args: { runId: v.id("collectionRuns") },
  handler: async (ctx, { runId }) => {
    await ctx.db.patch(runId, { finishedAt: Date.now() })
  },
})

const RECENT_RUN_LIMIT = 30

/**
 * The last few sweeps, newest first, so storage growth can be watched rather
 * than inferred. Counts only — no hashes and no document ids — so this says
 * nothing about any particular artist's work, but it is still gated on being
 * signed in, since an anonymous caller has no reason to read it.
 */
export const recentRuns = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    if (userId === null) throw new ConvexError("Sign in to see storage runs.")
    const runs = await ctx.db
      .query("collectionRuns")
      .withIndex("by_started")
      .order("desc")
      .take(RECENT_RUN_LIMIT)
    return runs.map((run) => ({
      id: run._id,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt ?? null,
      scannedCount: run.scannedCount,
      collectedCount: run.collectedCount,
      reclaimedBytes: run.reclaimedBytes,
      retainedInGraceCount: run.retainedInGraceCount,
    }))
  },
})
