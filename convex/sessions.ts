import { v } from "convex/values"

import { requireOwnDocument } from "./documents"
import { mutation, query } from "./_generated/server"

/**
 * How stale a session's last heartbeat may be before it no longer counts as
 * "open". Longer than any one heartbeat interval a client uses, so a tab that
 * is merely between beats is never mistaken for one that has closed.
 */
const ACTIVE_WINDOW_MS = 15_000

/** A tab or device saying it still has this document open (18). */
export const heartbeat = mutation({
  args: { documentId: v.id("documents"), sessionId: v.string() },
  handler: async (ctx, { documentId, sessionId }) => {
    await requireOwnDocument(ctx, documentId)
    const existing = await ctx.db
      .query("sessions")
      .withIndex("by_document_session", (q) =>
        q.eq("documentId", documentId).eq("sessionId", sessionId)
      )
      .unique()
    const now = Date.now()
    if (existing) await ctx.db.patch(existing._id, { lastSeen: now })
    else
      await ctx.db.insert("sessions", { documentId, sessionId, lastSeen: now })

    // Housekeeping rides along on the write every open session is already
    // making, rather than needing a cron of its own: a session long past the
    // active window is not coming back to clean up after itself.
    const stale = await ctx.db
      .query("sessions")
      .withIndex("by_document", (q) => q.eq("documentId", documentId))
      .collect()
    for (const row of stale)
      if (row.lastSeen < now - ACTIVE_WINDOW_MS * 4)
        await ctx.db.delete(row._id)
  },
})

/**
 * Whether some other session currently has this document open. Reactive: a
 * heartbeat from either side re-runs every subscriber's query, which is what
 * lets the warning appear and clear itself without a poll of its own.
 */
export const openElsewhere = query({
  args: { documentId: v.id("documents"), sessionId: v.string() },
  handler: async (ctx, { documentId, sessionId }) => {
    await requireOwnDocument(ctx, documentId)
    const cutoff = Date.now() - ACTIVE_WINDOW_MS
    const rows = await ctx.db
      .query("sessions")
      .withIndex("by_document", (q) => q.eq("documentId", documentId))
      .collect()
    return rows.some(
      (row) => row.sessionId !== sessionId && row.lastSeen >= cutoff
    )
  },
})
