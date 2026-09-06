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
  })
    // The library lists one owner's documents newest-first; the index carries
    // `updatedAt` so that ordering is the index order, not a post-sort.
    .index("by_owner_updated", ["ownerId", "updatedAt"]),
})
