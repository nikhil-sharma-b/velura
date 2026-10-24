"use client"
import { useConvex, useQuery } from "convex/react"
import { useMemo } from "react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { parseVectorBrush } from "@/engine/brush/vector-brush"
import type { VectorBrushStore } from "./vector-brush-store"

export function useConvexVectorBrushStore(): VectorBrushStore {
  const convex = useConvex()
  return useMemo(
    () =>
      ({
        useVectorBrushLibrary() {
          const rows = useQuery(api.vectorBrushes.list)
          return useMemo(
            () => ({
              loaded: rows !== undefined,
              brushes: (rows ?? []).flatMap((row) => {
                try {
                  return [parseVectorBrush({ ...row.definition, id: row._id })]
                } catch {
                  return []
                }
              }),
            }),
            [rows]
          )
        },
        save: (brush) =>
          convex.mutation(api.vectorBrushes.save, { definition: brush }),
        update: (id, brush) =>
          convex.mutation(api.vectorBrushes.update, {
            brushId: id as Id<"vectorBrushes">,
            definition: brush,
          }),
        rename: (id, name) =>
          convex.mutation(api.vectorBrushes.rename, {
            brushId: id as Id<"vectorBrushes">,
            name,
          }),
        remove: (id) =>
          convex.mutation(api.vectorBrushes.remove, {
            brushId: id as Id<"vectorBrushes">,
          }),
      }) satisfies VectorBrushStore,
    [convex]
  )
}
