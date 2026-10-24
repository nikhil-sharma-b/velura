import { getAuthUserId } from "@convex-dev/auth/server"
import { ConvexError, v } from "convex/values"

import { isSmudge } from "../engine/brush/smudge"
import type { Doc, Id } from "./_generated/dataModel"
import {
  type MutationCtx,
  type QueryCtx,
  mutation,
  query,
} from "./_generated/server"
import {
  MAX_BRUSHES,
  nextOrderIn,
  normaliseBrushDefinition,
  normaliseBrushName,
  normaliseSetName,
  normaliseStoredTexture,
  normaliseTextureName,
  reorderBrushes,
} from "./lib/brush"

/**
 * The brush library on the account (25) — which is the whole of what "my
 * brushes are on every machine I sign into" means.
 *
 * Built-in brushes are deliberately absent: they ship in the client
 * (`engine/brush/presets.ts`), so there is no row for one and therefore no
 * mutation that could destroy one. A table holding copies of them would need a
 * flag, a guard on every write, and a migration each time a preset changed.
 *
 * The shape is `palettes.ts`'s: one door to a row, ownership checked there, so
 * "not yours" and "not there" answer identically.
 */

async function requireUserId(
  ctx: QueryCtx | MutationCtx
): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx)
  if (userId === null) throw new ConvexError("Sign in to keep your brushes.")
  return userId
}

async function requireOwnBrush(
  ctx: QueryCtx | MutationCtx,
  brushId: Id<"brushes">
): Promise<Doc<"brushes">> {
  const userId = await requireUserId(ctx)
  const brush = await ctx.db.get(brushId)
  if (brush === null || brush.ownerId !== userId)
    throw new ConvexError("That brush does not exist.")
  return brush
}

/** Re-throws a rule from `lib/brush.ts` as the error type a client can read. */
function storable<T>(work: () => T): T {
  try {
    return work()
  } catch (error) {
    throw new ConvexError((error as Error).message)
  }
}

async function ownBrushes(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">
): Promise<Doc<"brushes">[]> {
  return await ctx.db
    .query("brushes")
    .withIndex("by_owner", (q) => q.eq("ownerId", userId))
    .collect()
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    // Signed out is an empty shelf rather than an error: the panel still has
    // the built-ins to show, and should not have to catch anything to show
    // them.
    if (userId === null) return []
    const brushes = await ownBrushes(ctx, userId)
    return brushes.sort((a, b) => a.order - b.order)
  },
})

export const listTextures = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    if (userId === null) return []
    return await ctx.db
      .query("brushTextures")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect()
  },
})

export const save = mutation({
  args: {
    name: v.string(),
    set: v.optional(v.string()),
    definition: v.any(),
  },
  handler: async (ctx, { name, set, definition }) => {
    const userId = await requireUserId(ctx)
    const stored = storable(() => normaliseBrushDefinition(definition))
    const brushes = await ownBrushes(ctx, userId)
    if (brushes.length >= MAX_BRUSHES)
      throw new ConvexError(`A library holds at most ${MAX_BRUSHES} brushes.`)
    const shelf = normaliseSetName(set ?? "")
    const order = nextOrderIn(brushes, shelf)
    const now = Date.now()
    return await ctx.db.insert("brushes", {
      ownerId: userId,
      name: normaliseBrushName(name),
      set: shelf,
      order,
      definition: stored,
      createdAt: now,
      updatedAt: now,
    })
  },
})

export const update = mutation({
  args: { brushId: v.id("brushes"), definition: v.any() },
  handler: async (ctx, { brushId, definition }) => {
    const brush = await requireOwnBrush(ctx, brushId)
    await ctx.db.patch(brush._id, {
      definition: storable(() => normaliseBrushDefinition(definition)),
      updatedAt: Date.now(),
    })
  },
})

export const rename = mutation({
  args: { brushId: v.id("brushes"), name: v.string() },
  handler: async (ctx, { brushId, name }) => {
    const brush = await requireOwnBrush(ctx, brushId)
    await ctx.db.patch(brush._id, {
      name: normaliseBrushName(name),
      updatedAt: Date.now(),
    })
  },
})

export const remove = mutation({
  args: { brushId: v.id("brushes") },
  handler: async (ctx, { brushId }) => {
    const brush = await requireOwnBrush(ctx, brushId)
    await ctx.db.delete(brush._id)
  },
})

export const move = mutation({
  args: { brushId: v.id("brushes"), set: v.string(), index: v.number() },
  handler: async (ctx, { brushId, set, index }) => {
    const brush = await requireOwnBrush(ctx, brushId)
    const brushes = await ownBrushes(ctx, brush.ownerId)
    const changes = reorderBrushes(
      brushes.map((row) => ({ id: row._id, set: row.set, order: row.order })),
      brushId,
      set,
      index
    )
    const updatedAt = Date.now()
    // Only the placements that actually moved are written: dragging one brush
    // in a set of forty is a few patches, not forty.
    for (const change of changes)
      await ctx.db.patch(change.id as Id<"brushes">, {
        set: change.set,
        order: change.order,
        updatedAt,
      })
  },
})

export const saveTexture = mutation({
  args: {
    name: v.string(),
    width: v.number(),
    height: v.number(),
    frameCount: v.optional(v.number()),
    data: v.bytes(),
  },
  handler: async (ctx, { name, width, height, frameCount, data }) => {
    const userId = await requireUserId(ctx)
    const texture = storable(() =>
      normaliseStoredTexture({
        width,
        height,
        frameCount,
        data: new Uint8Array(data),
      })
    )
    return await ctx.db.insert("brushTextures", {
      ownerId: userId,
      name: normaliseTextureName(name),
      width: texture.width,
      height: texture.height,
      ...(texture.frameCount === undefined
        ? {}
        : { frameCount: texture.frameCount }),
      // Stored as the bytes it will be uploaded as: the row is the asset, and
      // a re-encoding here would be a second definition of what a texel is.
      data: texture.data.buffer.slice(
        texture.data.byteOffset,
        texture.data.byteOffset + texture.data.byteLength
      ) as ArrayBuffer,
      createdAt: Date.now(),
    })
  },
})

export const lastUsed = query({
  args: { documentId: v.id("documents") },
  handler: async (ctx, { documentId }) => {
    const userId = await getAuthUserId(ctx)
    if (userId === null) return null
    const row = await ctx.db
      .query("brushUse")
      .withIndex("by_owner_document", (q) =>
        q.eq("ownerId", userId).eq("documentId", documentId)
      )
      .unique()
    return row
      ? {
          brushId: row.brushId,
          radius: row.radius,
          ...(row.smudge ? { smudge: row.smudge } : {}),
        }
      : null
  },
})

export const recordLastUsed = mutation({
  args: {
    documentId: v.id("documents"),
    brushId: v.string(),
    radius: v.number(),
    smudge: v.optional(v.object({ radius: v.number(), strength: v.number() })),
  },
  handler: async (ctx, { documentId, brushId, radius, smudge }) => {
    const userId = await requireUserId(ctx)
    if (!Number.isFinite(radius) || radius <= 0)
      throw new ConvexError("A brush radius must be a positive number.")
    if (smudge && !isSmudge(smudge))
      throw new ConvexError(
        "A smudge needs a positive radius and a strength from 0 to 1."
      )
    if (!brushId) throw new ConvexError("A brush id is needed.")
    const row = await ctx.db
      .query("brushUse")
      .withIndex("by_owner_document", (q) =>
        q.eq("ownerId", userId).eq("documentId", documentId)
      )
      .unique()
    const updatedAt = Date.now()
    // A write that names no smudge leaves the one already remembered.
    const named = smudge ? { smudge } : {}
    if (row)
      await ctx.db.patch(row._id, { brushId, radius, ...named, updatedAt })
    else
      await ctx.db.insert("brushUse", {
        ownerId: userId,
        documentId,
        brushId,
        radius,
        ...named,
        updatedAt,
      })
  },
})
