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
  moveColor,
  normaliseColors,
  normalisePaletteName,
  normaliseSwatch,
  recordRecent,
} from "./lib/palette"

async function requireUserId(
  ctx: QueryCtx | MutationCtx
): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx)
  if (userId === null) throw new ConvexError("Sign in to keep your palettes.")
  return userId
}

/**
 * The single door to a palette row, in the shape `documents.ts` uses:
 * ownership is checked here rather than in each mutation, so "not yours" and
 * "not there" answer identically and a stranger cannot use the error to learn
 * that a palette id exists.
 */
async function requireOwnPalette(
  ctx: QueryCtx | MutationCtx,
  paletteId: Id<"palettes">
): Promise<Doc<"palettes">> {
  const userId = await requireUserId(ctx)
  const palette = await ctx.db.get(paletteId)
  if (palette === null || palette.ownerId !== userId)
    throw new ConvexError("That palette does not exist.")
  return palette
}

/**
 * Canonicalises on the way in, so a stored palette is always readable hex.
 * The rule itself lives in `lib/palette.ts`, shared with the picker; this only
 * re-throws it as the error type a Convex client can read.
 */
function storableColors(colors: readonly string[]): string[] {
  try {
    return normaliseColors(colors)
  } catch (error) {
    throw new ConvexError((error as Error).message)
  }
}

async function writeColors(
  ctx: MutationCtx,
  palette: Doc<"palettes">,
  colors: readonly string[]
) {
  await ctx.db.patch(palette._id, {
    colors: storableColors(colors),
    updatedAt: Date.now(),
  })
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    // Signed out is an empty shelf, not an error: the picker renders its own
    // signed-out state and should not have to catch anything to do it.
    if (userId === null) return []
    return await ctx.db
      .query("palettes")
      .withIndex("by_owner_created", (q) => q.eq("ownerId", userId))
      .collect()
  },
})

export const create = mutation({
  args: { name: v.optional(v.string()), colors: v.array(v.string()) },
  handler: async (ctx, { name, colors }) => {
    const userId = await requireUserId(ctx)
    const stored = storableColors(colors)
    const now = Date.now()
    return await ctx.db.insert("palettes", {
      ownerId: userId,
      name: normalisePaletteName(name ?? ""),
      colors: stored,
      createdAt: now,
      updatedAt: now,
    })
  },
})

export const rename = mutation({
  args: { paletteId: v.id("palettes"), name: v.string() },
  handler: async (ctx, { paletteId, name }) => {
    const palette = await requireOwnPalette(ctx, paletteId)
    await ctx.db.patch(palette._id, {
      name: normalisePaletteName(name),
      updatedAt: Date.now(),
    })
  },
})

export const remove = mutation({
  args: { paletteId: v.id("palettes") },
  handler: async (ctx, { paletteId }) => {
    const palette = await requireOwnPalette(ctx, paletteId)
    await ctx.db.delete(palette._id)
  },
})

export const addColor = mutation({
  args: { paletteId: v.id("palettes"), hex: v.string() },
  handler: async (ctx, { paletteId, hex }) => {
    const palette = await requireOwnPalette(ctx, paletteId)
    // A scheme may deliberately repeat a colour, so this appends rather than
    // deduplicating; the recents strip is the one that must not repeat.
    await writeColors(ctx, palette, [...palette.colors, hex])
  },
})

export const removeColorAt = mutation({
  args: { paletteId: v.id("palettes"), index: v.number() },
  handler: async (ctx, { paletteId, index }) => {
    const palette = await requireOwnPalette(ctx, paletteId)
    await writeColors(
      ctx,
      palette,
      palette.colors.filter((_, at) => at !== index)
    )
  },
})

export const reorder = mutation({
  args: { paletteId: v.id("palettes"), from: v.number(), to: v.number() },
  handler: async (ctx, { paletteId, from, to }) => {
    const palette = await requireOwnPalette(ctx, paletteId)
    await writeColors(ctx, palette, moveColor(palette.colors, from, to))
  },
})

export const recent = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    if (userId === null) return []
    const row = await ctx.db
      .query("colorRecents")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .unique()
    return row?.colors ?? []
  },
})

export const recordUsed = mutation({
  args: { hex: v.string() },
  handler: async (ctx, { hex }) => {
    const userId = await requireUserId(ctx)
    if (normaliseSwatch(hex) === null)
      throw new ConvexError(`${hex} is not a colour.`)
    const row = await ctx.db
      .query("colorRecents")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .unique()
    const colors = recordRecent(row?.colors ?? [], hex)
    const updatedAt = Date.now()
    if (row) await ctx.db.patch(row._id, { colors, updatedAt })
    else
      await ctx.db.insert("colorRecents", {
        ownerId: userId,
        colors,
        updatedAt,
      })
  },
})
