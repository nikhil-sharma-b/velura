import { ConvexError, v } from "convex/values"

import { requireOwnDocument } from "./documents"
import { internalQuery, mutation, query } from "./_generated/server"

export const create = mutation({
  args: { documentId: v.id("documents") },
  handler: async (ctx, { documentId }) => {
    const document = await requireOwnDocument(ctx, documentId)
    if (document.previewVersion === undefined) {
      throw new ConvexError("Sync this document before sharing it.")
    }
    const existing = await ctx.db
      .query("shareLinks")
      .withIndex("by_document", (q) => q.eq("documentId", documentId))
      .unique()
    if (existing !== null) return { token: existing.token }

    const token = crypto.randomUUID()
    await ctx.db.insert("shareLinks", {
      documentId,
      token,
      createdAt: Date.now(),
    })
    return { token }
  },
})

export const revoke = mutation({
  args: { documentId: v.id("documents") },
  handler: async (ctx, { documentId }) => {
    await requireOwnDocument(ctx, documentId)
    const link = await ctx.db
      .query("shareLinks")
      .withIndex("by_document", (q) => q.eq("documentId", documentId))
      .unique()
    if (link !== null) await ctx.db.delete(link._id)
  },
})

export const publicView = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const link = await ctx.db
      .query("shareLinks")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique()
    if (link === null) return null
    const document = await ctx.db.get(link.documentId)
    if (document === null) return null

    if (document.previewVersion === undefined) return null
    return { previewVersion: document.previewVersion }
  },
})

export const resolveDocumentId = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const link = await ctx.db
      .query("shareLinks")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique()
    if (link === null) return null
    const document = await ctx.db.get(link.documentId)
    return document === null
      ? null
      : { documentId: link.documentId, key: document.previewObjectKey }
  },
})
