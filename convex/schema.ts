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
    // Stable browser-local identity used only while claiming anonymous work.
    // Keeping it makes a lost mutation response safe to retry without making
    // a duplicate document in the account.
    anonymousSourceId: v.optional(v.string()),
    // The layer tree without pixels — engine/doc/structure.ts's
    // `DocumentStructure`, opaque here. Absent until the first flush; a
    // session reopening on a cleared cache reads this plus the `tiles` rows
    // to rebuild the document (§9.3).
    structure: v.optional(v.any()),
    // Incremented after a flush replaces previews/<document>.png.
    // The value refreshes signed library URLs without storing expiring URLs.
    previewVersion: v.optional(v.number()),
  })
    // The library lists one owner's documents newest-first; the index carries
    // `updatedAt` so that ordering is the index order, not a post-sort.
    .index("by_owner_updated", ["ownerId", "updatedAt"])
    .index("by_owner_anonymous_source", ["ownerId", "anonymousSourceId"]),

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

  // A restore point: what the document looked like at one flush, as the set
  // of tile hashes it named then (§9.4). Pixels are not copied — a version
  // references blobs the `tiles` rows and the GC cron already keep alive, so
  // a week of history costs rows, not storage. Written at every flush and
  // thinned on a time decay (convex/lib/retention.ts) by the same mutation,
  // so history never grows without bound and no cron is needed to bound it.
  versions: defineTable({
    documentId: v.id("documents"),
    createdAt: v.number(),
    structure: v.any(),
    tiles: v.array(
      v.object({
        surfaceId: v.string(),
        x: v.number(),
        y: v.number(),
        hash: v.string(),
      })
    ),
  }).index("by_document_created", ["documentId", "createdAt"]),

  // Per-flush R2 operation counts, so the free-tier Class A budget (the
  // binding cost constraint per architecture.md §9.6) has a real number
  // behind it instead of an estimate.
  syncMetrics: defineTable({
    documentId: v.id("documents"),
    putCount: v.number(),
    mutationCount: v.number(),
    createdAt: v.number(),
  }).index("by_document", ["documentId"]),

  // One row per orphan-collection run (D17). Deleting user pixels
  // is the one operation with no undo, so each sweep leaves a record of what
  // it scanned, what it reclaimed, and what the grace window held back — both
  // so storage growth can be observed and so a run that deleted more than it
  // should have can be recognised as such afterwards. `finishedAt` is absent
  // on a run that was interrupted part-way; its counters still hold, because
  // the sweep records each batch as it completes rather than at the end.
  collectionRuns: defineTable({
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
    scannedCount: v.number(),
    collectedCount: v.number(),
    reclaimedBytes: v.number(),
    retainedInGraceCount: v.number(),
  }).index("by_started", ["startedAt"]),

  // A named palette of swatches (23). Colours are sRGB hex strings, ordered:
  // the order is the artist's arrangement of the scheme, so it is stored as an
  // array rather than as rows, which would need a separate sort key and could
  // not be reordered in one write.
  palettes: defineTable({
    ownerId: v.id("users"),
    name: v.string(),
    colors: v.array(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_owner_created", ["ownerId", "createdAt"]),

  // At most one row per artist: the colours most recently painted with,
  // newest first. On the account rather than on the document, because the
  // working set an artist carries is theirs and follows them between pieces
  // and between machines.
  colorRecents: defineTable({
    ownerId: v.id("users"),
    colors: v.array(v.string()),
    updatedAt: v.number(),
  }).index("by_owner", ["ownerId"]),

  // One row per tab/device with a document open, heartbeat-refreshed while it
  // stays open (18). This is what lets a session opening a document already
  // open elsewhere warn instead of letting two tabs silently race each
  // other's flushes.
  sessions: defineTable({
    documentId: v.id("documents"),
    sessionId: v.string(),
    lastSeen: v.number(),
  })
    .index("by_document", ["documentId"])
    .index("by_document_session", ["documentId", "sessionId"]),
})
