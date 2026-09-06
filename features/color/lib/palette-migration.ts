import type { PaletteRecord } from "./palette-store"

/**
 * Carries palettes built before signing in into the new account, the way
 * `features/studio/lib/anonymous-migration.ts` does for documents (22). A
 * scheme is work, and an artist who builds one anonymously and then signs in
 * should not find it gone — which is what "palettes persist across sessions
 * and machines" has to mean for someone whose first session had no account.
 *
 * A palette that fails stays on this device and is retried on the next sign-in,
 * and one that succeeded is dropped locally so a retry cannot duplicate it.
 */

export type LocalPalettes = {
  read(): { palettes: readonly PaletteRecord[]; recent: readonly string[] }
  /** Replaces what is kept on this device with what has not made it up yet. */
  keepOnly(palettes: readonly PaletteRecord[]): void
}

export type PaletteUpload = {
  create(name: string, colors: readonly string[]): Promise<string>
  recordUsed(hex: string): Promise<unknown>
}

export type PaletteMigrationResult = Readonly<{
  migrated: number
  remaining: number
}>

export async function migrateLocalPalettes(options: {
  local: LocalPalettes
  remote: PaletteUpload
}): Promise<PaletteMigrationResult> {
  const { palettes, recent } = options.local.read()
  const stranded: PaletteRecord[] = []
  let migrated = 0

  for (const palette of palettes) {
    try {
      await options.remote.create(palette.name, palette.colors)
      migrated++
    } catch {
      stranded.push(palette)
    }
  }

  // Oldest first, because the account's list is built by recording each in
  // turn: replaying them newest-first would leave the strip reversed.
  for (const hex of [...recent].reverse()) {
    try {
      await options.remote.recordUsed(hex)
    } catch {
      // A recent colour is a convenience, not work. Losing one is not worth
      // holding back the palettes, which are.
    }
  }

  if (migrated > 0) options.local.keepOnly(stranded)

  return { migrated, remaining: stranded.length }
}
