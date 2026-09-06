"use client"

import { useConvex } from "convex/react"
import { useEffect, useRef } from "react"
import { toast } from "sonner"

import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { createLocalBlobStore } from "@/engine/store/blob-store"
import { createConvexRemoteIndex } from "@/features/library/lib/convex-remote-index"
import { migrateAnonymousDocuments } from "@/features/studio/lib/anonymous-migration"
import { resetAnonymousDocumentId } from "@/features/studio/lib/anonymous-document"

/** Runs once after authentication; local manifests themselves are retry state. */
export function AnonymousMigration() {
  const convex = useConvex()
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
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
