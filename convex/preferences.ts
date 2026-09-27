import { getAuthUserId } from "@convex-dev/auth/server"
import { ConvexError, v } from "convex/values"

import type { Doc, Id } from "./_generated/dataModel"
import {
  type MutationCtx,
  type QueryCtx,
  mutation,
  query,
} from "./_generated/server"
import { mergeKeybinds, normaliseKeybinds } from "./lib/preferences"

const keybindsValidator = v.record(v.string(), v.array(v.string()))

async function requireUserId(
  ctx: QueryCtx | MutationCtx
): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx)
  if (userId === null)
    throw new ConvexError("Sign in to keep your preferences.")
  return userId
}

async function ownRow(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">
): Promise<Doc<"preferences"> | null> {
  return await ctx.db
    .query("preferences")
    .withIndex("by_owner", (q) => q.eq("ownerId", userId))
    .unique()
}

async function writeKeybinds(
  ctx: MutationCtx,
  userId: Id<"users">,
  row: Doc<"preferences"> | null,
  keybinds: Record<string, string[]>
) {
  const updatedAt = Date.now()
  if (row) await ctx.db.patch(row._id, { keybinds, updatedAt })
  else
    await ctx.db.insert("preferences", { ownerId: userId, keybinds, updatedAt })
}

/**
 * The artist's preferences, or null when there are none yet. Null rather than
 * empty defaults, so a client can tell "nothing stored" — keep what this
 * device has — from "stored as nothing", which should clear it.
 */
export const get = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    if (userId === null) return null
    const row = await ownRow(ctx, userId)
    return row ? { keybinds: row.keybinds } : null
  },
})

/** Replaces the artist's keybind overrides with the sparse set given. */
export const setKeybinds = mutation({
  args: { keybinds: keybindsValidator },
  handler: async (ctx, { keybinds }) => {
    const userId = await requireUserId(ctx)
    const row = await ownRow(ctx, userId)
    await writeKeybinds(ctx, userId, row, normaliseKeybinds(keybinds))
  },
})

/** Carries overrides made before signing in into the account (anonymous upgrade). */
export const claimKeybinds = mutation({
  args: { keybinds: keybindsValidator },
  handler: async (ctx, { keybinds }) => {
    const userId = await requireUserId(ctx)
    const row = await ownRow(ctx, userId)
    const merged = mergeKeybinds(
      normaliseKeybinds(keybinds),
      row?.keybinds ?? {}
    )
    await writeKeybinds(ctx, userId, row, merged)
    return merged
  },
})
