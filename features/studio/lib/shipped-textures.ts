import { decodeGrayPng } from "@/engine/brush/gray-png"
import type { GrayscaleTexture } from "@/engine/brush/texture"

import kritaManifest from "./krita-textures.json"

/**
 * The textures Velura ships beyond the procedural three (brush library 01):
 * tips and papers from Krita's default resources, written to
 * `public/brushes/krita/` by `tooling/krita-assets.ts`.
 *
 * Listed eagerly and loaded lazily. The manifest is a few kilobytes and is
 * what lets the editor offer every texture at once; the pixels are megabytes,
 * and only the ones a brush actually names are fetched, once, the first time
 * it names them.
 */

export type ShippedTexture = Readonly<{
  /** `krita:<slug>`, as a brush stores it. Never changes. */
  id: string
  name: string
  /** A tip is coverage over the dab; a grain is the paper under it. */
  kind: "tip" | "grain"
  /** Relative to the library's base; more than one is a tip set's frames. */
  files: readonly string[]
  /** The file in the source bundle it was converted from. */
  source: string
  /** How a tip set picks a frame per dab, as the source file named it. */
  selection?: string
}>

export type ShippedTextureManifest = Readonly<{
  source: Readonly<{
    name: string
    repository: string
    commit: string
    licence: string
    authors: readonly string[]
  }>
  textures: readonly ShippedTexture[]
}>

export type ShippedTextures = {
  readonly manifest: ShippedTextureManifest
  has(id: string): boolean
  ofKind(kind: ShippedTexture["kind"]): readonly ShippedTexture[]
  /** The texture's pixels, or undefined for an id this library does not ship. */
  load(id: string): Promise<GrayscaleTexture | undefined>
}

type Fetch = (url: string) => Promise<Response>

export function createShippedTextures(
  manifest: ShippedTextureManifest,
  base: string,
  fetch: Fetch
): ShippedTextures {
  const byId = new Map(manifest.textures.map((t) => [t.id, t]))
  const loading = new Map<string, Promise<GrayscaleTexture>>()
  return {
    manifest,
    has: (id) => byId.has(id),
    ofKind: (kind) => manifest.textures.filter((t) => t.kind === kind),
    async load(id) {
      const entry = byId.get(id)
      if (!entry) return undefined
      let pending = loading.get(id)
      if (!pending) {
        // A tip set is drawn by its first frame until the renderer can pick
        // between them (brush library 04); the rest are not fetched for it.
        const url = `${base}/${entry.files[0]}`
        pending = fetch(url).then(async (response) => {
          if (!response.ok)
            throw new Error(`${entry.name} could not be loaded.`)
          return decodeGrayPng(new Uint8Array(await response.arrayBuffer()))
        })
        loading.set(id, pending)
        // A failure is not remembered: a flaky connection should not leave a
        // brush unpaintable for the rest of the session.
        pending.catch(() => loading.delete(id))
      }
      return pending
    },
  }
}

/** Krita's CC0 default resources, as the studio loads them. */
export const KRITA_TEXTURES: ShippedTextures = createShippedTextures(
  kritaManifest as ShippedTextureManifest,
  "/brushes/krita",
  (url) => globalThis.fetch(url)
)
