import type { SyncStatus } from "@/engine"

/**
 * What lets a library card show its preview without waiting on the network.
 *
 * Two sources, both held for the life of the page:
 *
 * - The preview a canvas just encoded on this device, handed over by the
 *   engine before it is even uploaded. Leaving a canvas for the library
 *   otherwise shows the previous picture, or none, until the upload, the
 *   commit, a presign and a download have all gone round.
 * - The signed URL each card was last given. A fresh signature is a new URL
 *   and so never a browser-cache hit; reusing one while it is still valid
 *   makes coming back to the library a cache read.
 */

/** A preview encoded on this device, and the version it became, once known. */
export type LocalPreview = {
  url: string
  /** Undefined while its upload is in flight. */
  version: number | undefined
  /** When it was taken, against `DeviceState.syncingSince`. */
  seq: number
}

/**
 * Whether this device's own preview is still the newest picture of the
 * document. One still uploading always is — nothing can have landed after a
 * flush that has not finished — and a committed one is until some other
 * device commits a later version.
 */
export function localPreviewIsCurrent(
  local: LocalPreview | undefined,
  previewVersion: number | undefined
): local is LocalPreview {
  if (!local) return false
  return local.version === undefined || local.version >= (previewVersion ?? 0)
}

// `convex/lib/r2.ts` signs for 15 minutes. A URL is only reused well inside
// that, so an image requested just before expiry still loads.
const SIGNED_URL_REUSE_MS = 10 * 60 * 1000

type SignedPreview = { version: number; url: string; signedAt: number }

/** A signed URL still worth reusing for this version, or undefined. */
export function reusableSignedUrl(
  entry: SignedPreview | undefined,
  version: number,
  now: number
): string | undefined {
  if (!entry || entry.version !== version) return undefined
  return now - entry.signedAt < SIGNED_URL_REUSE_MS ? entry.url : undefined
}

const signed = new Map<string, SignedPreview>()

export function cachedSignedUrl(
  documentId: string,
  version: number
): string | undefined {
  return reusableSignedUrl(signed.get(documentId), version, Date.now())
}

export function rememberSignedUrl(
  documentId: string,
  version: number,
  url: string
): void {
  signed.set(documentId, { version, url, signedAt: Date.now() })
}

/** A URL that failed to load is not handed out again. */
export function forgetSignedUrl(documentId: string): void {
  signed.delete(documentId)
}

/**
 * What this device knows about a document that the server may not yet: the
 * preview it last encoded, and whether a flush of it is still under way.
 * Replaced, never mutated, so a card can subscribe to it by identity.
 */
export type DeviceState = {
  local?: LocalPreview
  /** Set while this device is syncing the document; ordered with `local.seq`. */
  syncingSince?: number
}

const devices = new Map<string, DeviceState>()
const listeners = new Set<() => void>()
let sequence = 0

function update(documentId: string, next: DeviceState) {
  if (next.local || next.syncingSince !== undefined)
    devices.set(documentId, next)
  else devices.delete(documentId)
  for (const listener of listeners) listener()
}

/** Takes the engine's preview for a document, replacing any older one. */
export function recordLocalPreview(
  documentId: string,
  preview: { bytes: Uint8Array; committed: Promise<number | undefined> }
): void {
  const state = devices.get(documentId) ?? {}
  if (state.local) URL.revokeObjectURL(state.local.url)
  const url = URL.createObjectURL(
    new Blob([preview.bytes as BlobPart], { type: "image/png" })
  )
  const entry: LocalPreview = { url, version: undefined, seq: ++sequence }
  update(documentId, { ...state, local: entry })
  // A flush that fails leaves the picture pending, and so still shown: it is
  // what this device last painted, and the next flush that lands replaces it.
  void preview.committed.then(
    (version) => {
      const current = devices.get(documentId)
      if (current?.local !== entry || version === undefined) return
      update(documentId, { ...current, local: { ...entry, version } })
    },
    () => {}
  )
}

/** Follows the engine's sync status, which outlives the canvas it came from. */
export function recordSyncStatus(documentId: string, status: SyncStatus): void {
  const state = devices.get(documentId) ?? {}
  const syncing = status === "syncing"
  if (syncing === (state.syncingSince !== undefined)) return
  update(documentId, {
    ...state,
    syncingSince: syncing ? ++sequence : undefined,
  })
}

export function deviceState(documentId: string): DeviceState | undefined {
  return devices.get(documentId)
}

export function subscribeDeviceState(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Whether the picture a card is about to show is behind the document: this
 * device is still sending changes it has no picture of yet, or the server
 * has a newer preview than the one in hand.
 */
export function previewIsStale(
  device: DeviceState | undefined,
  shownVersion: number | undefined,
  previewVersion: number | undefined
): boolean {
  const syncing = device?.syncingSince
  if (syncing !== undefined && (device?.local?.seq ?? 0) < syncing) return true
  if (localPreviewIsCurrent(device?.local, previewVersion)) return false
  return previewVersion !== undefined && shownVersion !== previewVersion
}
