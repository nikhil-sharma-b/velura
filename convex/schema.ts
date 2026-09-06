import { authTables } from "@convex-dev/auth/server"
import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"

// `authTables` owns identity: accounts, sessions, verification codes. Only the
// `users` row is ours to extend, and D40 says the plan and quota fields land in
// the first migration even though nothing reads them yet — retrofitting quota
// accounting across a tile store later is the expensive path.
export default defineSchema({
  ...authTables,

  users: defineTable({
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    image: v.optional(v.string()),
    isAnonymous: v.optional(v.boolean()),

    // Unused in v1. The gate reads `plan` and finds "free".
    plan: v.optional(v.literal("free")),
    storageBytes: v.optional(v.number()),
    docCount: v.optional(v.number()),
  }).index("email", ["email"]),

  documents: defineTable({
    ownerId: v.id("users"),
    name: v.string(),
    width: v.number(),
    height: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
    // The layer tree without pixels — engine/doc/structure.ts's
    // `DocumentStructure`, opaque here. Absent until the first flush; a
    // session reopening on a cleared cache reads this plus the `tiles` rows
    // to rebuild the document (§9.3).
    structure: v.optional(v.any()),
  })
    // The library lists one owner's documents newest-first; the index carries
    // `updatedAt` so that ordering is the index order, not a post-sort.
    .index("by_owner_updated", ["ownerId", "updatedAt"]),

  // One row per (document, surface, tile coordinate). D13: independently
  // mutable rows so concurrent flushes never contend on a single document
  // blob, and a reopen can page/subscribe tile-by-tile instead of loading
  // one big index. `hash` alone names the R2 object; this row only says
  // which hash currently occupies this slot.
  tiles: defineTable({
    documentId: v.id("documents"),
    surfaceId: v.string(),
    x: v.number(),
    y: v.number(),
    hash: v.string(),
    updatedAt: v.number(),
  })
    .index("by_document", ["documentId"])
    .index("by_document_surface_tile", ["documentId", "surfaceId", "x", "y"]),

  // Every hash ever confirmed uploaded to R2, across all documents. Content
  // addressing means the same tile pixels hash the same way regardless of
  // which document painted them, so this is the dedup ledger the "which
  // hashes does the server lack" check reads — a Convex query, not an R2
  // HeadObject round trip, since R2 ops are the metered, budget-constrained
  // resource (D40 / architecture.md §13).
  blobs: defineTable({
    hash: v.string(),
    size: v.number(),
    createdAt: v.number(),
  }).index("by_hash", ["hash"]),

  // Per-flush R2 operation counts, so the free-tier Class A budget (the
  // binding cost constraint per architecture.md §9.6) has a real number
  // behind it instead of an estimate.
  syncMetrics: defineTable({
    documentId: v.id("documents"),
    putCount: v.number(),
    mutationCount: v.number(),
    createdAt: v.number(),
  }).index("by_document", ["documentId"]),
})
