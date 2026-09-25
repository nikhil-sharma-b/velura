import { v } from "convex/values"

import { requireOwnDocument } from "./documents"
import { recordVersion } from "./versions"
import type { Id } from "./_generated/dataModel"
import { type MutationCtx, mutation, query } from "./_generated/server"

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
 * The single write per flush: upsert every changed tile index row, record
 * newly confirmed blob hashes so future flushes (this document or any other)
 * skip re-uploading them, bump the document's `updatedAt`, and log the R2
 * operation counts for the flush. Safe to retry — every write here is an
 * upsert keyed by content, not an append.
 */
export const commitFlush = mutation({
  args: {
    documentId: v.id("documents"),
    tiles: v.array(tileArg),
    uploaded: v.array(v.object({ hash: v.string(), size: v.number() })),
    structure: v.any(),
    metrics: v.object({ putCount: v.number(), mutationCount: v.number() }),
  },
  handler: async (ctx, { documentId, tiles, uploaded, structure, metrics }) => {
    const document = await requireOwnDocument(ctx, documentId)

    for (const tile of tiles) {
      await upsertTile(ctx, documentId, tile)
    }

    for (const blob of uploaded) {
      await recordBlob(ctx, blob.hash, blob.size)
    }

    await ctx.db.patch(documentId, {
      structure,
      updatedAt: Math.max(Date.now(), document.updatedAt + 1),
    })

    // The flush payload is the whole document, not a delta, so the restore
    // point is that same tile set written down under a time (§9.4) — no
    // second pass over the tile rows, and no pixels duplicated.
    await recordVersion(ctx, documentId, { structure, tiles })

    await ctx.db.insert("syncMetrics", {
      documentId,
      putCount: metrics.putCount,
      mutationCount: metrics.mutationCount,
      createdAt: Date.now(),
    })
  },
})

/** Makes a successfully uploaded preview visible to reactive library clients. */
export const commitPreview = mutation({
  args: { documentId: v.id("documents") },
  handler: async (ctx, { documentId }) => {
    const document = await requireOwnDocument(ctx, documentId)
    const previewVersion = (document.previewVersion ?? 0) + 1
    await ctx.db.patch(documentId, { previewVersion })
    return previewVersion
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
