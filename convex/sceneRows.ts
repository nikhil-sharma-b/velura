import type { Id } from "./_generated/dataModel"
import type { MutationCtx, QueryCtx } from "./_generated/server"
import { joinScenes, sceneChunkHashes, splitScenes } from "./lib/scenes"

/**
 * The database half of convex/lib/scenes.ts: where a document's scene chunks
 * are written, read back and let go of.
 */

async function chunkRow(
  ctx: QueryCtx,
  documentId: Id<"documents">,
  hash: string
) {
  return await ctx.db
    .query("sceneChunks")
    .withIndex("by_document_hash", (q) =>
      q.eq("documentId", documentId).eq("hash", hash)
    )
    .unique()
}

/**
 * Writes the chunks of a flushed tree that the document does not hold yet and
 * returns the tree as it is stored. An unchanged scene costs reads only.
 */
export async function storeScenes(
  ctx: MutationCtx,
  documentId: Id<"documents">,
  structure: unknown
): Promise<unknown> {
  const split = await splitScenes(structure)
  for (const [hash, data] of split.chunks)
    if ((await chunkRow(ctx, documentId, hash)) === null)
      await ctx.db.insert("sceneChunks", { documentId, hash, data })
  return split.structure
}

/**
 * A stored tree with its scenes put back in. Typed as it came in: a tree is
 * opaque to Convex (`v.any()`), and joining only swaps hashes for objects.
 */
export async function readScenes<T>(
  ctx: QueryCtx,
  documentId: Id<"documents">,
  structure: T
): Promise<T> {
  return (await joinScenes(structure, async (hashes) => {
    const rows = await Promise.all(
      hashes.map((hash) => chunkRow(ctx, documentId, hash))
    )
    return new Map(
      rows.flatMap((row) => (row ? [[row.hash, row.data] as const] : []))
    )
  })) as T
}

/**
 * Drops the chunks that only the trees in `dropped` named. Every tree that
 * names a chunk is either the document's or a restore point's, so asking the
 * trees being let go of — rather than scanning the rows — keeps a flush from
 * reading every scene the document has.
 */
export async function releaseScenes(
  ctx: MutationCtx,
  documentId: Id<"documents">,
  dropped: readonly unknown[],
  kept: readonly unknown[]
): Promise<void> {
  const live = new Set(kept.flatMap((tree) => [...sceneChunkHashes(tree)]))
  const candidates = new Set(
    dropped.flatMap((tree) => [...sceneChunkHashes(tree)])
  )
  for (const hash of candidates) {
    if (live.has(hash)) continue
    const row = await chunkRow(ctx, documentId, hash)
    if (row) await ctx.db.delete(row._id)
  }
}

/** Every scene row a document has, for copying or removing it whole. */
export async function sceneRowsOf(ctx: QueryCtx, documentId: Id<"documents">) {
  return await ctx.db
    .query("sceneChunks")
    .withIndex("by_document_hash", (q) => q.eq("documentId", documentId))
    .collect()
}
