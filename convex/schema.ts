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
    // to rebuild the document (§9.3). Carries the document's guides (16),
    // which `commitFlush` normalises on the way in (convex/lib/guides.ts).
    structure: v.optional(v.any()),
    // Incremented after a preview upload lands. The value refreshes signed
    // library URLs without storing expiring URLs.
    previewVersion: v.optional(v.number()),
    // New previews use immutable object keys. A duplicate can then reference
    // the exact picture captured with its tiles, even if the source changes.
    // Older documents without this field still read previews/<id>.png.
    previewObjectKey: v.optional(v.string()),
    // The document timestamp from the flush this preview depicts. During a
    // newer flush, the old preview must not be copied with newer tiles.
    previewForUpdatedAt: v.optional(v.number()),
  })
    // The library lists one owner's documents newest-first; the index carries
    // `updatedAt` so that ordering is the index order, not a post-sort.
    .index("by_owner_updated", ["ownerId", "updatedAt"])
    .index("by_owner_anonymous_source", ["ownerId", "anonymousSourceId"]),

  // One opaque capability per shared document. Public readers resolve this
  // row to the flattened preview only; the document id, owner and structure
  // never cross the public query boundary.
  shareLinks: defineTable({
    documentId: v.id("documents"),
    token: v.string(),
    createdAt: v.number(),
  })
    .index("by_document", ["documentId"])
    .index("by_token", ["token"]),

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

  // A piece of a vector layer's scene (20), by the hash of its text. The
  // document's `structure` and each restore point's name a scene as a list of
  // these hashes instead of holding its objects, so a large scene cannot push
  // either row past the document limit, and a restore point costs hashes, not
  // a copy of every shape. Rows are per document rather than shared: a scene
  // is Convex data, not an R2 object, so there is no upload to save, and a
  // document owning its rows can drop them without asking any other.
  // See convex/lib/scenes.ts.
  sceneChunks: defineTable({
    documentId: v.id("documents"),
    hash: v.string(),
    data: v.string(),
  }).index("by_document_hash", ["documentId", "hash"]),

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

  // A brush the artist made (25). The definition is the serialisable brush of
  // `engine/brush/brush.ts` — shape, grain, rendering and the dynamics list —
  // opaque here and normalised on the way in by `convex/lib/brush.ts`, the way
  // `documents.structure` is opaque to this table. Kept on the account rather
  // than on a document, because a tool belongs to the artist and follows them
  // to whatever they open next, and to whatever machine they open it on.
  //
  // `set` and `order` are the artist's arrangement of a growing library. A set
  // is a name on a brush rather than a row of its own: an empty set is one
  // nothing is shelved in, which is the same thing as it not existing, and a
  // set with rows would need deleting, renaming and garbage collecting to say
  // exactly that.
  brushes: defineTable({
    ownerId: v.id("users"),
    name: v.string(),
    set: v.string(),
    order: v.number(),
    definition: v.any(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_owner", ["ownerId"]),

  // A greyscale texture a brush names (24): a tip in stamp space or paper in
  // canvas space. Bytes on the row rather than a blob in R2 — a tip is
  // kilobytes, it is read on every session that paints with the brush, and the
  // point of the tile store's R2 split is megabyte-scale immutable pixels, not
  // this. One byte per texel, top row first, exactly as the uploader wants it.
  brushTextures: defineTable({
    ownerId: v.id("users"),
    name: v.string(),
    width: v.number(),
    height: v.number(),
    frameCount: v.optional(v.number()),
    data: v.bytes(),
    createdAt: v.number(),
  }).index("by_owner", ["ownerId"]),

  // What was in the hand when a document was last painted in (25). On the
  // account and against the document, so reopening a piece on any machine
  // picks the brush back up rather than starting from a default that has
  // nothing to do with what is on the canvas. Size is stored beside the brush
  // id because size is adjusted constantly and almost never saved into a
  // brush: restoring the brush without it would still be the wrong tool.
  brushUse: defineTable({
    ownerId: v.id("users"),
    documentId: v.id("documents"),
    brushId: v.string(),
    radius: v.number(),
    // The smudge tool's own size and strength (smudge 02). Absent on rows
    // written before it had any.
    smudge: v.optional(v.object({ radius: v.number(), strength: v.number() })),
    updatedAt: v.number(),
  }).index("by_owner_document", ["ownerId", "documentId"]),

  // At most one row per artist: settings that belong to the person rather
  // than to a document, so they follow them between machines (v2 04). The
  // keybinds are the sparse overrides of `features/commands/lib/overrides.ts`,
  // by command id; a command not listed keeps whatever its default is now.
  vectorBrushes: defineTable({
    ownerId: v.id("users"),
    definition: v.any(),
    updatedAt: v.number(),
  }).index("by_owner", ["ownerId"]),

  preferences: defineTable({
    ownerId: v.id("users"),
    keybinds: v.record(v.string(), v.array(v.string())),
    // Absent until the artist first shows or hides them (08).
    rulersVisible: v.optional(v.boolean()),
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
