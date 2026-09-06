import type { Brush } from "@/engine/brush/brush"
import type { GrayscaleTexture } from "@/engine/brush/texture"

import type { StoredBrush, StoredTexture } from "./brush-store"

/**
 * Carries brushes made before signing in into the new account, the way
 * `features/color/lib/palette-migration.ts` does for palettes (22/25).
 *
 * A brush is work — often more of it than a painting — and an artist who
 * shapes one anonymously and then signs in should not find it gone. A brush
 * that fails stays on this device and is retried on the next sign-in; one that
 * succeeded is dropped locally, so a retry cannot duplicate it.
 *
 * Textures go up first and their new ids are threaded through the definitions
 * that named them. A local texture id means nothing on the account, so a brush
 * carried up unchanged would arrive pointing at a texture that does not exist
 * and draw untextured — the failure being invisible until the artist noticed
 * their paper had gone.
 */

export type LocalBrushes = {
  read(): {
    brushes: readonly StoredBrush[]
    textures: readonly StoredTexture[]
  }
  /** Replaces what is kept on this device with what has not made it up yet. */
  keepOnly(brushes: readonly StoredBrush[]): void
}

export type BrushUpload = {
  save(name: string, set: string, definition: Brush): Promise<string>
  saveTexture(name: string, texture: GrayscaleTexture): Promise<string>
}

export type BrushMigrationResult = Readonly<{
  migrated: number
  remaining: number
}>

/** The same brush with its texture ids rewritten to what they became. */
function rehomed(brush: Brush, ids: ReadonlyMap<string, string>): Brush {
  const next = structuredClone(brush)
  const tip = next.shape.tipTextureId
  if (tip && ids.has(tip)) next.shape.tipTextureId = ids.get(tip)
  if (next.grain && ids.has(next.grain.textureId))
    next.grain = { ...next.grain, textureId: ids.get(next.grain.textureId)! }
  return next
}

export async function migrateLocalBrushes(options: {
  local: LocalBrushes
  remote: BrushUpload
}): Promise<BrushMigrationResult> {
  const { brushes, textures } = options.local.read()
  const ids = new Map<string, string>()
  for (const texture of textures) {
    try {
      ids.set(
        texture.id,
        await options.remote.saveTexture(texture.name, texture.texture)
      )
    } catch {
      // Left out of `ids`, which is what strands the brushes naming it.
    }
  }

  const local = new Set(textures.map((texture) => texture.id))
  /**
   * Whether this brush's assets all made it up. A brush whose paper stayed
   * behind would arrive on the account naming a texture that does not exist
   * there and quietly draw untextured — a loss the artist would not see until
   * they next picked it up, by which time this device may have been cleared.
   * Held back instead, and retried whole on the next sign-in.
   */
  const assetsArrived = (brush: StoredBrush["brush"]) =>
    [brush.shape.tipTextureId, brush.grain?.textureId].every(
      (id) => !id || !local.has(id) || ids.has(id)
    )

  const stranded: StoredBrush[] = []
  let migrated = 0
  for (const stored of brushes) {
    try {
      if (!assetsArrived(stored.brush))
        throw new Error("Its texture has not been carried up yet.")
      await options.remote.save(
        stored.name,
        stored.set,
        rehomed(stored.brush, ids)
      )
      migrated++
    } catch {
      stranded.push(stored)
    }
  }

  if (migrated > 0) options.local.keepOnly(stranded)
  return { migrated, remaining: stranded.length }
}
