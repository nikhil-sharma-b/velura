import { getAuthUserId } from "@convex-dev/auth/server"
import { ConvexError, v } from "convex/values"

import type { Doc, Id } from "./_generated/dataModel"
import {
  type MutationCtx,
  type QueryCtx,
  mutation,
  query,
} from "./_generated/server"
import {
  canvasSizeProblem,
  DEFAULT_DOCUMENT_NAME,
  duplicateName,
  normaliseDocumentName,
} from "./lib/documents"
import { isAnonymousDocumentId } from "../lib/anonymous-document-id"

async function requireUserId(
  ctx: QueryCtx | MutationCtx
): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx)
  if (userId === null)
    throw new ConvexError("Sign in to work with your documents.")
  return userId
}

/**
 * The single door to a document row. Ownership is checked here rather than in
 * each mutation, so "not yours" and "not there" answer identically — a stranger
 * cannot use the error to learn that a document id exists.
 */
export async function requireOwnDocument(
  ctx: QueryCtx | MutationCtx,
  documentId: Id<"documents">
): Promise<Doc<"documents">> {
  const userId = await requireUserId(ctx)
  const document = await ctx.db.get(documentId)
  if (document === null || document.ownerId !== userId) {
    throw new ConvexError("That document does not exist.")
  }
  return document
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    // Signed out is an empty library, not an error: the page renders its own
    // signed-out state and should not have to catch anything to do it.
    if (userId === null) return []
    return await ctx.db
      .query("documents")
      .withIndex("by_owner_updated", (q) => q.eq("ownerId", userId))
      .order("desc")
      .collect()
  },
})

export const get = query({
  args: { documentId: v.id("documents") },
  handler: async (ctx, { documentId }) =>
    await requireOwnDocument(ctx, documentId),
})

export const create = mutation({
  args: {
    name: v.optional(v.string()),
    width: v.number(),
    height: v.number(),
  },
  handler: async (ctx, { name, width, height }) => {
    const userId = await requireUserId(ctx)
    const problem = canvasSizeProblem(width, height)
    if (problem !== null) throw new ConvexError(problem)

    const now = Date.now()
    const documentId = await ctx.db.insert("documents", {
      ownerId: userId,
      name: normaliseDocumentName(name ?? DEFAULT_DOCUMENT_NAME),
      width,
      height,
      createdAt: now,
      updatedAt: now,
    })
    return documentId
  },
})

/**
 * Gives a browser-local document an owned cloud identity. `sourceId` is a
 * durable idempotency key: if the client loses the response after insertion,
 * the same request returns the row already made instead of duplicating it.
 */
export const claimAnonymous = mutation({
  args: {
    sourceId: v.string(),
    name: v.optional(v.string()),
    width: v.number(),
    height: v.number(),
  },
  handler: async (ctx, { sourceId, name, width, height }) => {
    const userId = await requireUserId(ctx)
    const problem = canvasSizeProblem(width, height)
    if (problem !== null) throw new ConvexError(problem)
    if (!isAnonymousDocumentId(sourceId)) {
      throw new ConvexError("That is not an anonymous document id.")
    }

    const existing = await ctx.db
      .query("documents")
      .withIndex("by_owner_anonymous_source", (q) =>
        q.eq("ownerId", userId).eq("anonymousSourceId", sourceId)
      )
      .unique()
    if (existing !== null) return existing._id

    const now = Date.now()
    return await ctx.db.insert("documents", {
      ownerId: userId,
      anonymousSourceId: sourceId,
      name: normaliseDocumentName(name ?? DEFAULT_DOCUMENT_NAME),
      width,
      height,
      createdAt: now,
      updatedAt: now,
    })
  },
})

export const rename = mutation({
  args: { documentId: v.id("documents"), name: v.string() },
  handler: async (ctx, { documentId, name }) => {
    const document = await requireOwnDocument(ctx, documentId)
    const next = normaliseDocumentName(name)
    // A rename that changes nothing must not reorder the library.
    if (next === document.name) return
    await ctx.db.patch(documentId, {
      name: next,
      updatedAt: nextUpdatedAt(document.updatedAt),
    })
  },
})

export const duplicate = mutation({
  args: { documentId: v.id("documents") },
  handler: async (ctx, { documentId }) => {
    const source = await requireOwnDocument(ctx, documentId)
    // One artist's own library, which the create path keeps small; naming a
    // copy needs the names, and there is no index on name to narrow this by.
    const siblings = await ctx.db
      .query("documents")
      .withIndex("by_owner_updated", (q) => q.eq("ownerId", source.ownerId))
      .collect()

    const now = Date.now()
    // Pixels are not copied because there are none yet (ticket 16 owns tiles);
    // what is copied is the document's identity: owner, size and name lineage.
    const copyId = await ctx.db.insert("documents", {
      ownerId: source.ownerId,
      name: duplicateName(
        source.name,
        siblings.map((doc) => doc.name)
      ),
      width: source.width,
      height: source.height,
      createdAt: now,
      updatedAt: now,
    })
    return copyId
  },
})

export const remove = mutation({
  args: { documentId: v.id("documents") },
  handler: async (ctx, { documentId }) => {
    await requireOwnDocument(ctx, documentId)
    await ctx.db.delete(documentId)
  },
})

/**
 * `updatedAt` orders the library. A rename inside the same millisecond as the
 * row's last write would tie, and the tie falls back on creation time — exactly
 * the order the rename was meant to change. Advancing by a millisecond keeps
 * "most recently touched first" true however fast the writes land. Inserts need
 * no such nudge: for two rows created in the same millisecond, creation order
 * and the intended order already agree.
 */
function nextUpdatedAt(previous: number): number {
  return Math.max(Date.now(), previous + 1)
}
