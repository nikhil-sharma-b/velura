/**
 * Preference rules that hold with or without a database, in the shape of
 * `convex/lib/palette.ts`: the mutation canonicalises what it stores with the
 * same parser the keybind editor reads its local cache with, so a chord typed
 * as `Mod+U` on one machine is the same `mod+u` on the next.
 */

import {
  parseOverrides,
  type KeybindOverrides,
} from "../../features/commands/lib/overrides"

export function normaliseKeybinds(
  keybinds: Record<string, readonly string[]>
): Record<string, string[]> {
  const parsed = parseOverrides(keybinds)
  return Object.fromEntries(
    Object.entries(parsed).map(([id, chords]) => [id, [...new Set(chords)]])
  )
}

/**
 * Anonymous overrides laid under the account's: a command the account already
 * has an opinion about keeps it, since that choice was made signed in and may
 * already be in use on another machine; a command it has not touched takes
 * what was set before signing in.
 */
export function mergeKeybinds(
  local: KeybindOverrides,
  account: KeybindOverrides
): Record<string, string[]> {
  const merged: Record<string, string[]> = {}
  for (const [id, chords] of Object.entries(local)) merged[id] = [...chords]
  for (const [id, chords] of Object.entries(account)) merged[id] = [...chords]
  return merged
}
