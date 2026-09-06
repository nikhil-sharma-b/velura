"use client"

import { useConvex } from "convex/react"
import { useEffect, useRef } from "react"
import { toast } from "sonner"

import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { createLocalBlobStore } from "@/engine/store/blob-store"
import { createConvexRemoteIndex } from "@/features/library/lib/convex-remote-index"
import { createLocalPalettes } from "@/features/color/lib/local-palette-store"
import { migrateLocalPalettes } from "@/features/color/lib/palette-migration"
import { migrateAnonymousDocuments } from "@/features/studio/lib/anonymous-migration"
import { createLocalBrushes } from "@/features/studio/lib/local-brush-store"
import { migrateLocalBrushes } from "@/features/studio/lib/brush-migration"
import { resetAnonymousDocumentId } from "@/features/studio/lib/anonymous-document"

/** Runs once after authentication; local manifests themselves are retry state. */
export function AnonymousMigration() {
  const convex = useConvex()
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    // Palettes are small and independent of the pixels, so they go up on
    // their own rather than riding on a document flush that may not happen.
    const palettes = createLocalPalettes(localStorage)
    void migrateLocalPalettes({
      local: palettes,
      remote: {
        create: async (name, colors) =>
          await convex.mutation(api.palettes.create, {
            name,
            colors: [...colors],
          }),
        recordUsed: (hex) => convex.mutation(api.palettes.recordUsed, { hex }),
      },
    }).then(
      ({ migrated, remaining }) => {
        if (migrated > 0)
          toast.success(
            migrated === 1
              ? "Your palette is now on your account."
              : `${migrated} palettes are now on your account.`
          )
        if (remaining > 0)
          toast.error(
            "Some palettes could not be saved to your account. They are safe on this device and will retry next time."
          )
      },
      () => {
        toast.error(
          "Palettes could not be checked. They remain safe on this device."
        )
      }
    )

    // Brushes go up the same way and for the same reason: a brush shaped
    // before signing in is work, and it should be on the account rather than
    // stranded on the browser that made it (25).
    const brushes = createLocalBrushes(localStorage)
    void migrateLocalBrushes({
      local: brushes,
      remote: {
        save: async (name, set, definition) =>
          await convex.mutation(api.brushes.save, { name, set, definition }),
        saveTexture: async (name, texture) =>
          await convex.mutation(api.brushes.saveTexture, {
            name,
            width: texture.width,
            height: texture.height,
            data: texture.data.slice().buffer as ArrayBuffer,
          }),
      },
    }).then(
      ({ migrated, remaining }) => {
        if (migrated > 0)
          toast.success(
            migrated === 1
              ? "Your brush is now on your account."
              : `${migrated} brushes are now on your account.`
          )
        if (remaining > 0)
          toast.error(
            "Some brushes could not be saved to your account. They are safe on this device and will retry next time."
          )
      },
      () => {
        toast.error(
          "Brushes could not be checked. They remain safe on this device."
        )
      }
    )

    void migrateAnonymousDocuments({
      blobs: createLocalBlobStore(),
      remote: {
        claimDocument: async (source) =>
          await convex.mutation(api.documents.claimAnonymous, {
            sourceId: source.id,
            name: source.name,
            width: source.width,
            height: source.height,
          }),
        forDocument: (documentId) =>
          createConvexRemoteIndex(convex, documentId as Id<"documents">),
      },
      onConfirmed: () => resetAnonymousDocumentId(),
    }).then(
      ({ migrated, remaining }) => {
        if (migrated > 0) {
          toast.success(
            migrated === 1
              ? "Your local drawing is now in your library."
              : `${migrated} local drawings are now in your library.`
          )
        }
        if (remaining > 0) {
          toast.error(
            "Some local drawings could not be uploaded. They are safe on this device and will retry next time."
          )
        }
      },
      () => {
        toast.error(
          "Local drawings could not be checked. They remain safe on this device."
        )
      }
    )
  }, [convex])

  return null
}
