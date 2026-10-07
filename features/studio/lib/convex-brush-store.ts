"use client"

import { useConvex, useQuery } from "convex/react"
import { useMemo } from "react"

import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { normaliseBrushDefinition } from "@/convex/lib/brush"

import type { BrushStore, StoredBrush, StoredTexture } from "./brush-store"

/**
 * Brushes on the account, which is what makes them follow the artist to
 * another machine (25). Reads are live queries, so a brush saved in one tab
 * appears in another without either one re-fetching.
 *
 * Textures come down beside the definitions rather than being fetched when a
 * brush that names one is chosen: a library of a dozen brushes is a handful of
 * kilobytes of paper, and having them in hand is what lets the panel register
 * them with the engine before the artist picks anything up.
 */
export function useConvexBrushStore(): BrushStore {
  const convex = useConvex()
  return useMemo<BrushStore>(
    () => ({
      useBrushLibrary(documentId?: string) {
        // Every hook runs unconditionally, in this order, on every render:
        // `useBrushLibrary` is a hook and is called as one. The last-used
        // query is skipped rather than conditional, which is how Convex says
        // "not yet" without changing the shape of the render.
        const brushes = useQuery(api.brushes.list)
        const textures = useQuery(api.brushes.listTextures)
        const lastUsed = useQuery(
          api.brushes.lastUsed,
          documentId ? { documentId: documentId as Id<"documents"> } : "skip"
        )
        return useMemo(
          () => ({
            brushes: (brushes ?? []).flatMap((row): StoredBrush[] => {
              try {
                return [
                  {
                    id: row._id,
                    name: row.name,
                    set: row.set,
                    order: row.order,
                    // A row is checked on the way in, but it is also older
                    // than this client may be: a definition that no longer
                    // parses is left out of the shelf rather than handed to
                    // the engine, which would refuse it mid-selection.
                    brush: normaliseBrushDefinition(row.definition),
                  },
                ]
              } catch {
                return []
              }
            }),
            textures: (textures ?? []).map((row): StoredTexture => ({
              id: row._id,
              name: row.name,
              texture: {
                width: row.width,
                height: row.height,
                ...(row.frameCount === undefined
                  ? {}
                  : { frameCount: row.frameCount }),
                data: new Uint8Array(row.data),
              },
            })),
            lastUsed: lastUsed ?? null,
            loaded:
              brushes !== undefined &&
              textures !== undefined &&
              (!documentId || lastUsed !== undefined),
          }),
          [brushes, textures, lastUsed, documentId]
        )
      },
      save: (name, set, brush) =>
        convex.mutation(api.brushes.save, { name, set, definition: brush }),
      update: (id, brush) =>
        convex.mutation(api.brushes.update, {
          brushId: id as Id<"brushes">,
          definition: brush,
        }),
      rename: (id, name) =>
        convex.mutation(api.brushes.rename, {
          brushId: id as Id<"brushes">,
          name,
        }),
      remove: (id) =>
        convex.mutation(api.brushes.remove, { brushId: id as Id<"brushes"> }),
      move: (id, set, index) =>
        convex.mutation(api.brushes.move, {
          brushId: id as Id<"brushes">,
          set,
          index,
        }),
      saveTexture: (name, texture) =>
        convex.mutation(api.brushes.saveTexture, {
          name,
          width: texture.width,
          height: texture.height,
          ...(texture.frameCount === undefined
            ? {}
            : { frameCount: texture.frameCount }),
          // A fresh buffer, so a view onto a larger array — which a canvas
          // readback usually is — travels as its own texels and nothing else.
          data: texture.data.slice().buffer as ArrayBuffer,
        }),
      recordLastUsed: (documentId, brushId, radius) =>
        convex.mutation(api.brushes.recordLastUsed, {
          documentId: documentId as Id<"documents">,
          brushId,
          radius,
        }),
    }),
    [convex]
  )
}
