"use node"

import { v } from "convex/values"

import {
  presignPreviewGet,
  presignPreviewPut,
  presignTileGet,
  presignTilePut,
} from "./lib/r2"
import { action } from "./_generated/server"
import { api } from "./_generated/api"
import { internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"

/**
 * One batch mint per flush: every missing hash gets a presigned PUT in a
 * single round trip, rather than one Convex call per tile (D16). Ownership
 * is checked via the same query the client would use to open the document,
 * so a presigned URL never issues for a document the caller cannot see.
 */
export const presignUploads = action({
  args: { documentId: v.id("documents"), hashes: v.array(v.string()) },
  handler: async (ctx, { documentId, hashes }) => {
    await ctx.runQuery(api.documents.get, { documentId })
    return await Promise.all(
      hashes.map(async (hash) => ({ hash, url: await presignTilePut(hash) }))
    )
  },
})

/** Same batching for reads: one action call mints every GET a load needs. */
export const presignDownloads = action({
  args: { documentId: v.id("documents"), hashes: v.array(v.string()) },
  handler: async (ctx, { documentId, hashes }) => {
    await ctx.runQuery(api.documents.get, { documentId })
    return await Promise.all(
      hashes.map(async (hash) => ({ hash, url: await presignTileGet(hash) }))
    )
  },
})

export const presignPreviewUpload = action({
  args: { documentId: v.id("documents") },
  handler: async (ctx, { documentId }) => {
    await ctx.runQuery(api.documents.get, { documentId })
    return await presignPreviewPut(documentId)
  },
})

export const presignPreviewDownload = action({
  args: { documentId: v.id("documents") },
  handler: async (ctx, { documentId }) => {
    await ctx.runQuery(api.documents.get, { documentId })
    return await presignPreviewGet(documentId)
  },
})

/**
 * The share token is checked on every image request. The returned capability
 * names only the flattened preview object; no tile or structure URL is ever
 * minted for a public visitor.
 */
export const presignSharedPreviewDownload = action({
  args: { token: v.string() },
  handler: async (ctx, { token }): Promise<string | null> => {
    const documentId: Id<"documents"> | null = await ctx.runQuery(
      internal.shareLinks.resolveDocumentId,
      { token }
    )
    if (documentId === null) return null
    return await presignPreviewGet(documentId)
  },
})
