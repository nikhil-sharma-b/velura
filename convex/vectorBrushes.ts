import { getAuthUserId } from "@convex-dev/auth/server"
import { ConvexError, v } from "convex/values"
import { mutation, query, type MutationCtx } from "./_generated/server"
import type { Id } from "./_generated/dataModel"
import { parseVectorBrush } from "../engine/brush/vector-brush"

async function own(ctx: MutationCtx, id: Id<"vectorBrushes">) {
  const userId = await getAuthUserId(ctx)
  const row = await ctx.db.get(id)
  if (!userId || !row || row.ownerId !== userId)
    throw new ConvexError("That vector brush does not exist.")
  return row
}
export const list = query({
  args: {},
  handler: async (ctx) => {
    const ownerId = await getAuthUserId(ctx)
    if (!ownerId) return []
    return await ctx.db
      .query("vectorBrushes")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .collect()
  },
})
export const save = mutation({
  args: { definition: v.any() },
  handler: async (ctx, { definition }) => {
    const ownerId = await getAuthUserId(ctx)
    if (!ownerId) throw new ConvexError("Sign in to keep your vector brushes.")
    const brush = parseVectorBrush(definition)
    const rows = await ctx.db
      .query("vectorBrushes")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .collect()
    if (rows.length >= 500)
      throw new ConvexError("A library holds at most 500 vector brushes.")
    return await ctx.db.insert("vectorBrushes", {
      ownerId,
      definition: brush,
      updatedAt: Date.now(),
    })
  },
})
export const update = mutation({
  args: { brushId: v.id("vectorBrushes"), definition: v.any() },
  handler: async (ctx, { brushId, definition }) => {
    await own(ctx, brushId)
    await ctx.db.patch(brushId, {
      definition: parseVectorBrush({ ...definition, id: brushId }),
      updatedAt: Date.now(),
    })
  },
})
export const rename = mutation({
  args: { brushId: v.id("vectorBrushes"), name: v.string() },
  handler: async (ctx, { brushId, name }) => {
    const row = await own(ctx, brushId)
    await ctx.db.patch(brushId, {
      definition: parseVectorBrush({ ...row.definition, id: brushId, name }),
      updatedAt: Date.now(),
    })
  },
})
export const remove = mutation({
  args: { brushId: v.id("vectorBrushes") },
  handler: async (ctx, { brushId }) => {
    await own(ctx, brushId)
    await ctx.db.delete(brushId)
  },
})
