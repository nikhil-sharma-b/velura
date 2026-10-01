import { ConvexError, v } from "convex/values"

import { requireOwnDocument } from "./documents"
import type { Id } from "./_generated/dataModel"
import { type MutationCtx, query } from "./_generated/server"
import { prunableVersions } from "./lib/retention"
import { readScenes } from "./sceneRows"

/**
 * Restore points (§9.4). Deliberately not a synced undo stack (D9): undo is
 * session-scoped and local, so what it cannot cover is the work an artist
 * painted over in a session that has since been closed. A version answers
 * that and nothing more — a coarse, time-labelled ladder back through the
 * document's own past.
 */

/**
 * The ladder, newest first: times only, not tile sets. A document open for a
 * week has a few dozen restore points and each names every tile in the
 * document, so the list the panel renders must not carry the pixels' names
 * with it.
 */
export const list = query({
  args: { documentId: v.id("documents") },
  handler: async (ctx, { documentId }) => {
    await requireOwnDocument(ctx, documentId)
    const versions = await ctx.db
      .query("versions")
      .withIndex("by_document_created", (q) => q.eq("documentId", documentId))
      .order("desc")
      .collect()
    return versions.map((version) => ({
      id: version._id,
      createdAt: version.createdAt,
    }))
  },
})

/** One restore point in full: the layer tree and the tiles it named. */
export const get = query({
  args: { versionId: v.id("versions") },
  handler: async (ctx, { versionId }) => {
    const version = await ctx.db.get(versionId)
    // Ownership is the document's to answer, and a missing version and a
    // foreign one answer alike for the same reason `requireOwnDocument` does.
    if (version === null) throw new ConvexError("That restore point is gone.")
    await requireOwnDocument(ctx, version.documentId)
    return {
      id: version._id,
      createdAt: version.createdAt,
      structure: await readScenes(ctx, version.documentId, version.structure),
      tiles: version.tiles,
    }
  },
})

/**
 * Writes the restore point for a flush and thins the ladder behind it.
 *
 * Pruning rides on the write rather than on a cron because the decay is only
 * ever wrong immediately after a flush — that is the one moment new points
 * appear — and because it keeps the retained set correct for the mark-and-
 * sweep cron that reads it (D17). Called from `tiles.commitFlush`, which has
 * already checked ownership.
 *
 * A document nobody flushes again therefore keeps the ladder it had, decayed
 * as of its last flush. That is deliberate: the retained set only has to be
 * right for the sweep that reads it, and the sweep is what eventually reaps a
 * document nothing references (D17, ticket 21). What must never decay away is
 * the newest point — see `prunableVersions`.
 *
 * Returns the trees of the points thinned and of those still standing, so the
 * caller can let go of scene chunks only the thinned ones named.
 */
export async function recordVersion(
  ctx: MutationCtx,
  documentId: Id<"documents">,
  snapshot: {
    structure: unknown
    tiles: readonly {
      surfaceId: string
      x: number
      y: number
      hash: string
    }[]
  }
): Promise<{ pruned: unknown[]; kept: unknown[] }> {
  const now = Date.now()
  await ctx.db.insert("versions", {
    documentId,
    createdAt: now,
    structure: snapshot.structure,
    tiles: [...snapshot.tiles],
  })

  const versions = await ctx.db
    .query("versions")
    .withIndex("by_document_created", (q) => q.eq("documentId", documentId))
    .collect()
  const prunable = new Set(prunableVersions(versions, now))
  for (const version of prunable) await ctx.db.delete(version._id)
  return {
    pruned: [...prunable].map((version) => version.structure),
    kept: versions
      .filter((version) => !prunable.has(version))
      .map((version) => version.structure),
  }
}
