import type { Brush } from "@/engine/brush/brush"
import { BUILTIN_BRUSHES } from "@/engine/brush/presets"

import { DEFAULT_BRUSH_SET } from "@/convex/lib/brush"
import type { StoredBrush } from "./brush-store"

/**
 * The library as the panel shows it: built-ins and the artist's own on one
 * shelf, in sets (25).
 *
 * Pure functions over plain data, so what the panel renders — and, more to the
 * point, what may be deleted — is decided in a place a unit test can reach.
 * The rule that matters is one line of it: a built-in has no row behind it, so
 * `deletable` is false and every path that would remove one is closed by
 * construction rather than by a check somewhere in a click handler.
 */

/** The set the shipped brushes appear in. Not a stored set: there are no rows. */
export const BUILTIN_SET = "Built-in"

export type LibraryBrush = Readonly<{
  id: string
  name: string
  set: string
  brush: Brush
  builtin: boolean
  deletable: boolean
}>

export type BrushSet = Readonly<{
  name: string
  brushes: readonly LibraryBrush[]
}>

function builtinEntry(brush: Brush): LibraryBrush {
  return {
    id: brush.id,
    name: brush.name,
    set: BUILTIN_SET,
    brush,
    builtin: true,
    deletable: false,
  }
}

/**
 * A saved brush, named by its row.
 *
 * The definition carries a name too — it has to, since a brush is complete on
 * its own and travels in a file — but the row is what the artist renamed, so
 * the row wins and the definition is brought into line rather than left to
 * disagree with the label above it.
 */
function savedEntry(stored: StoredBrush): LibraryBrush {
  return {
    id: stored.id,
    name: stored.name,
    set: stored.set,
    brush: { ...stored.brush, id: stored.id, name: stored.name },
    builtin: false,
    deletable: true,
  }
}

/** The whole library, built-ins first and then each set in the order it was made. */
export function brushShelf(stored: readonly StoredBrush[]): BrushSet[] {
  const sets = new Map<string, LibraryBrush[]>()
  for (const brush of [...stored].sort((a, b) => a.order - b.order)) {
    const set = sets.get(brush.set) ?? []
    set.push(savedEntry(brush))
    sets.set(brush.set, set)
  }
  return [
    { name: BUILTIN_SET, brushes: BUILTIN_BRUSHES.map(builtinEntry) },
    ...[...sets].map(([name, brushes]) => ({ name, brushes })),
  ]
}

/** Every brush on the shelf, flat — what a selection is resolved against. */
export function libraryBrushes(stored: readonly StoredBrush[]): LibraryBrush[] {
  return brushShelf(stored).flatMap((set) => [...set.brushes])
}

export function resolveLibraryBrush(
  id: string,
  stored: readonly StoredBrush[]
): LibraryBrush | undefined {
  return libraryBrushes(stored).find((entry) => entry.id === id)
}

/**
 * A name for a copy that says where it came from and does not collide with a
 * name already on the shelf — because two brushes called "Pencil copy" are
 * indistinguishable in the one place the artist has to tell them apart.
 */
export function copyName(name: string, taken: readonly string[]): string {
  const base = `${name} copy`
  if (!taken.includes(base)) return base
  for (let suffix = 2; ; suffix++)
    if (!taken.includes(`${base} ${suffix}`)) return `${base} ${suffix}`
}

/**
 * The set a brush saved from the hand goes into: the one the brush it came
 * from is shelved in, or the artist's default when it came from a built-in or
 * from nothing. One definition, because the editor's Save and the library's
 * "Save as new" are the same act and an artist would not expect them to shelve
 * a brush in two different places.
 */
export function setForNewBrush(from: StoredBrush | undefined): string {
  return from?.set ?? DEFAULT_BRUSH_SET
}

/**
 * What saving a duplicate should ask for. A copy of a built-in lands in the
 * artist's own set: the shipped set has no rows in it, and a copy is a row.
 */
export function duplicateOf(
  entry: LibraryBrush,
  stored: readonly StoredBrush[]
): { name: string; set: string; brush: Brush } {
  return {
    name: copyName(
      entry.name,
      stored.map((brush) => brush.name)
    ),
    set: entry.builtin ? DEFAULT_BRUSH_SET : entry.set,
    // Cloned, so editing the copy can never reach the brush it came from —
    // which for a built-in is a frozen module constant.
    brush: structuredClone(entry.brush),
  }
}
