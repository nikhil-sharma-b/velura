import type { BlobStore } from "@/engine/store/blob-store"
import { isAnonymousDocumentId } from "@/lib/anonymous-document-id"
import {
  createCloudSync,
  type RemoteIndex,
  type UploadRetryOptions,
} from "@/engine/store/cloud-sync"
import {
  createDocumentStore,
  type DocumentManifest,
} from "@/engine/store/document-store"

export interface AnonymousMigrationRemote {
  /** Idempotently claims this local identity for the signed-in account. */
  claimDocument(source: DocumentManifest): Promise<string>
  forDocument(documentId: string): RemoteIndex
}

export type AnonymousMigrationResult = Readonly<{
  migrated: number
  remaining: number
}>

/**
 * Moves every anonymous manifest into the current account through the normal
 * cloud-sync path. A failed document stays local and can be retried; a
 * successful one loses only its manifest after the server has committed the
 * complete layer tree and tile index. Tile blobs remain as the local cache.
 */
export async function migrateAnonymousDocuments(options: {
  blobs: BlobStore
  remote: AnonymousMigrationRemote
  put?: (url: string, bytes: Uint8Array, contentType?: string) => Promise<void>
  /** Override for deterministic tests; production uses bounded backoff. */
  retry?: UploadRetryOptions
  /** Retires browser identity after confirmation, before local deletion. */
  onConfirmed?: (manifest: DocumentManifest) => void | Promise<void>
}): Promise<AnonymousMigrationResult> {
  const local = createDocumentStore(options.blobs)
  const manifests = (await local.list()).filter((document) =>
    isAnonymousDocumentId(document.id)
  )
  let migrated = 0

  for (const manifest of manifests) {
    try {
      const documentId = await options.remote.claimDocument(manifest)
      let failure: unknown
      const sync = createCloudSync({
        remote: options.remote.forDocument(documentId),
        snapshot: () => ({
          structure: manifest.structure,
          surfaces: manifest.surfaces,
        }),
        tiles: async (hash) => {
          const tile = await local.readTile(hash)
          if (!tile) throw new Error(`Local tile ${hash} is missing.`)
          return tile
        },
        ...(options.put ? { put: options.put } : {}),
        retry: options.retry,
        onError: (error) => {
          failure = error
        },
      })
      await sync.flush()
      if (failure !== undefined || sync.status() !== "fully-synced") {
        throw failure ?? new Error("Anonymous document did not finish syncing.")
      }
      await options.onConfirmed?.(manifest)
      if (await local.removeIfUnchanged(manifest)) migrated++
    } catch {
      // One damaged or temporarily offline document must not prevent the rest
      // from reaching the account. Its manifest is the durable retry marker.
    }
  }

  return { migrated, remaining: manifests.length - migrated }
}
