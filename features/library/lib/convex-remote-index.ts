import type { ConvexReactClient } from "convex/react"

import type { RemoteIndex } from "@/engine"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"

/** The cloud-sync `RemoteIndex` seam, wired to this document's Convex rows. */
export function createConvexRemoteIndex(
  client: ConvexReactClient,
  documentId: Id<"documents">
): RemoteIndex {
  return {
    missingHashes: (hashes) =>
      client.query(api.tiles.missingHashes, { hashes: [...hashes] }),
    presignUploads: (hashes) =>
      client.action(api.tilesActions.presignUploads, {
        documentId,
        hashes: [...hashes],
      }),
    presignPreviewUpload: () =>
      client.action(api.tilesActions.presignPreviewUpload, { documentId }),
    commitPreview: async () => {
      await client.mutation(api.tiles.commitPreview, { documentId })
    },
    commitFlush: async (payload) => {
      await client.mutation(api.tiles.commitFlush, {
        documentId,
        tiles: [...payload.tiles],
        uploaded: [...payload.uploaded],
        structure: payload.structure,
        metrics: payload.metrics,
      })
    },
    documentMeta: async () => {
      const document = await client.query(api.documents.get, { documentId })
      return {
        width: document.width,
        height: document.height,
        name: document.name,
        structure: document.structure ?? null,
        updatedAt: document.updatedAt,
      }
    },
    tileIndex: () => client.query(api.tiles.forDocument, { documentId }),
    presignDownloads: (hashes) =>
      client.action(api.tilesActions.presignDownloads, {
        documentId,
        hashes: [...hashes],
      }),
  }
}
