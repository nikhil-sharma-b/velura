import { v } from "convex/values"

import { requireOwnDocument } from "./documents"
import { withNormalisedGuides } from "./lib/guides"
import { releaseScenes, storeScenes } from "./sceneRows"
import { recordVersion } from "./versions"
import type { Id } from "./_generated/dataModel"
import {
  internalMutation,
  type MutationCtx,
  mutation,
  query,
} from "./_generated/server"

/**
 * Which of these hashes has never been confirmed uploaded, across any
 * document. Content addressing means a hash uploaded for one document is
 * good for every document — this is the dedup check the flush path runs
 * before minting any presigned PUTs, so unchanged and duplicate tiles never
 * reach R2 at all.
 */
export const missingHashes = query({
  args: { hashes: v.array(v.string()) },
  handler: async (ctx, { hashes }) => {
    const known = await Promise.all(
      hashes.map((hash) =>
        ctx.db
          .query("blobs")
          .withIndex("by_hash", (q) => q.eq("hash", hash))
          .unique()
      )
    )
    return hashes.filter((_, index) => known[index] === null)
  },
})

/** Current tile index for a document — what a reopening session loads. */
export const forDocument = query({
  args: { documentId: v.id("documents") },
  handler: async (ctx, { documentId }) => {
    await requireOwnDocument(ctx, documentId)
    return await ctx.db
      .query("tiles")
      .withIndex("by_document", (q) => q.eq("documentId", documentId))
      .collect()
  },
})

const tileArg = v.object({
  surfaceId: v.string(),
  x: v.number(),
  y: v.number(),
  hash: v.string(),
})

/**
 * The single write per flush: upsert every changed tile index row, drop the
 * rows the flushing device names as removed, record newly confirmed blob
 * hashes so future flushes (this document or any other) skip re-uploading
 * them, bump the document's `updatedAt`, and log the R2 operation counts for
 * the flush. Safe to retry — an upsert keyed by slot and a delete of a slot
 * already gone both leave the same rows behind.
 */
export const commitFlush = mutation({
  args: {
    documentId: v.id("documents"),
    tiles: v.array(tileArg),
    // Optional so a client from before removals were named still flushes.
    removed: v.optional(
      v.array(v.object({ surfaceId: v.string(), x: v.number(), y: v.number() }))
    ),
    uploaded: v.array(v.object({ hash: v.string(), size: v.number() })),
    structure: v.any(),
    metrics: v.object({ putCount: v.number(), mutationCount: v.number() }),
  },
  handler: async (
    ctx,
    { documentId, tiles, removed, uploaded, structure: raw, metrics }
  ) => {
    const document = await requireOwnDocument(ctx, documentId)
    // Scenes go to rows of their own and the tree keeps their hashes (20).
    const structure = await storeScenes(
      ctx,
      documentId,
      withNormalisedGuides(raw)
    )

    for (const tile of tiles) {
      await upsertTile(ctx, documentId, tile)
    }
    // Only what the flushing device says it removed — an erase, an undo, a
    // restore to an earlier state — and never a slot inferred from absence:
    // tile rows are last-writer-wins per slot (§9.5), and a device that never
    // saw a slot another device filled has no business deleting it. Only the
    // row goes; the blob is content-addressed and shared, and orphan
    // collection decides when nothing names it any more.
    for (const slot of removed ?? []) {
      const row = await ctx.db
        .query("tiles")
        .withIndex("by_document_surface_tile", (q) =>
          q
            .eq("documentId", documentId)
            .eq("surfaceId", slot.surfaceId)
            .eq("x", slot.x)
            .eq("y", slot.y)
        )
        .unique()
      if (row) await ctx.db.delete(row._id)
    }

    for (const blob of uploaded) {
      await recordBlob(ctx, blob.hash, blob.size)
    }

    const updatedAt = Math.max(Date.now(), document.updatedAt + 1)
    await ctx.db.patch(documentId, {
      structure,
      updatedAt,
    })

    // The flush payload is the whole document, not a delta, so the restore
    // point is that same tile set written down under a time (§9.4) — no
    // second pass over the tile rows, and no pixels duplicated.
    const ladder = await recordVersion(ctx, documentId, { structure, tiles })
    // The chunks the previous tree and the thinned points named, less any a
    // tree still standing names, are named by nothing now.
    await releaseScenes(
      ctx,
      documentId,
      [document.structure, ...ladder.pruned],
      ladder.kept
    )

    await ctx.db.insert("syncMetrics", {
      documentId,
      putCount: metrics.putCount,
      mutationCount: metrics.mutationCount,
      createdAt: Date.now(),
    })
    return updatedAt
  },
})

/** Makes a successfully uploaded preview visible to reactive library clients. */
export const commitPreview = mutation({
  args: {
    documentId: v.id("documents"),
    key: v.optional(v.string()),
    flushUpdatedAt: v.optional(v.number()),
  },
  handler: async (ctx, { documentId, key, flushUpdatedAt }) => {
    const document = await requireOwnDocument(ctx, documentId)
    const previewVersion = (document.previewVersion ?? 0) + 1
    await ctx.db.patch(documentId, {
      previewVersion,
      // An old client still uploads to previews/<id>.png. Clear a previous
      // immutable pointer in that case so readers use its legacy object.
      previewObjectKey: key,
      previewForUpdatedAt: key ? flushUpdatedAt : undefined,
    })
    return previewVersion
  },
})

/** `commitPreview` for a preview copied by the backend, with no caller to own it. */
export const commitCopiedPreview = internalMutation({
  args: {
    from: v.id("documents"),
    documentId: v.id("documents"),
    sourceVersion: v.number(),
    sourceUpdatedAt: v.number(),
    key: v.string(),
  },
  handler: async (
    ctx,
    { from, documentId, sourceVersion, sourceUpdatedAt, key }
  ) => {
    const source = await ctx.db.get(from)
    const document = await ctx.db.get(documentId)
    // The source or duplicate may have changed while the R2 copy ran. In
    // either case this image no longer belongs to the duplicate's snapshot.
    if (
      !source ||
      !document ||
      source.previewVersion !== sourceVersion ||
      source.updatedAt !== sourceUpdatedAt ||
      source.previewObjectKey !== undefined ||
      document.previewVersion !== undefined
    )
      return
    await ctx.db.patch(documentId, {
      previewVersion: 1,
      previewObjectKey: key,
    })
  },
})

async function upsertTile(
  ctx: MutationCtx,
  documentId: Id<"documents">,
  tile: { surfaceId: string; x: number; y: number; hash: string }
): Promise<void> {
  const existing = await ctx.db
    .query("tiles")
    .withIndex("by_document_surface_tile", (q) =>
      q
        .eq("documentId", documentId)
        .eq("surfaceId", tile.surfaceId)
        .eq("x", tile.x)
        .eq("y", tile.y)
    )
    .unique()

  if (existing === null) {
    await ctx.db.insert("tiles", { documentId, ...tile, updatedAt: Date.now() })
  } else if (existing.hash !== tile.hash) {
    await ctx.db.patch(existing._id, { hash: tile.hash, updatedAt: Date.now() })
  }
}

async function recordBlob(
  ctx: MutationCtx,
  hash: string,
  size: number
): Promise<void> {
  const existing = await ctx.db
    .query("blobs")
    .withIndex("by_hash", (q) => q.eq("hash", hash))
    .unique()
  if (existing === null) {
    await ctx.db.insert("blobs", { hash, size, createdAt: Date.now() })
  }
}
