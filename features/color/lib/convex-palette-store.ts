"use client"

import { useConvex, useQuery } from "convex/react"
import { useMemo } from "react"

import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"

import type { PaletteStore } from "./palette-store"

/**
 * Palettes on the account, which is what makes them follow the artist to
 * another machine (§23). Reads are live queries, so a palette saved in one tab
 * appears in another without either one re-fetching.
 */
export function useConvexPaletteStore(): PaletteStore {
  const convex = useConvex()
  return useMemo<PaletteStore>(
    () => ({
      usePaletteState() {
        // Both hooks run unconditionally, in this order, on every render:
        // `usePaletteState` is a hook and is called as one.
        const palettes = useQuery(api.palettes.list)
        const recent = useQuery(api.palettes.recent)
        return useMemo(
          () => ({
            palettes: (palettes ?? []).map((palette) => ({
              id: palette._id,
              name: palette.name,
              colors: palette.colors,
            })),
            recent: recent ?? [],
            loaded: palettes !== undefined && recent !== undefined,
          }),
          [palettes, recent]
        )
      },
      create: (name, colors) =>
        convex.mutation(api.palettes.create, { name, colors: [...colors] }),
      rename: (id, name) =>
        convex.mutation(api.palettes.rename, {
          paletteId: id as Id<"palettes">,
          name,
        }),
      remove: (id) =>
        convex.mutation(api.palettes.remove, {
          paletteId: id as Id<"palettes">,
        }),
      addColor: (id, hex) =>
        convex.mutation(api.palettes.addColor, {
          paletteId: id as Id<"palettes">,
          hex,
        }),
      removeColorAt: (id, index) =>
        convex.mutation(api.palettes.removeColorAt, {
          paletteId: id as Id<"palettes">,
          index,
        }),
      reorder: (id, from, to) =>
        convex.mutation(api.palettes.reorder, {
          paletteId: id as Id<"palettes">,
          from,
          to,
        }),
      recordUsed: (hex) => convex.mutation(api.palettes.recordUsed, { hex }),
    }),
    [convex]
  )
}
