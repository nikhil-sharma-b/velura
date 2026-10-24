import { isFieldKey, type Chord } from "./chord"
import type { Command, Registry } from "./registry"

/** How many commands the palette remembers having run. */
const RECENT_LIMIT = 5

/**
 * How well a query abbreviates a label, or nothing when it does not. Each
 * word of the query must appear, letters in order, after the word before it,
 * so "clr lay" finds "Clear layer". Letters that start a word or follow the
 * previous match score up, and letters skipped to reach a match score down,
 * so a prefix beats the same letters scattered through a longer label.
 */
export function fuzzyScore(query: string, label: string): number | undefined {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const text = label.toLowerCase()
  let score = 0
  let at = 0
  for (const word of words) {
    let previous = -2
    for (const letter of word) {
      const found = text.indexOf(letter, at)
      if (found < 0) return
      const startsWord = found === 0 || /[^a-z0-9]/.test(text[found - 1])
      if (startsWord) score += 3
      else if (found === previous + 1) score += 2
      score -= found - at
      previous = found
      at = found + 1
    }
  }
  return score
}

export interface PaletteEntry<Context> {
  command: Command<Context>
  keybinds: readonly Chord[]
  available: boolean
}

/**
 * The palette's rows for a query: every command that matches, best first,
 * with commands run recently ahead of the rest when the query cannot tell
 * them apart — which, for an empty query, is always.
 */
export function paletteEntries<Context>(
  registry: Registry<Context>,
  context: Context,
  query: string,
  recent: readonly string[],
  hidden: readonly string[] = []
): PaletteEntry<Context>[] {
  const recency = (id: string) => {
    const index = recent.indexOf(id)
    return index < 0 ? recent.length : index
  }
  return registry
    .list()
    .filter((command) => !hidden.includes(command.id))
    .flatMap((command, order) => {
      const score = fuzzyScore(query, command.label)
      return score === undefined ? [] : [{ command, score, order }]
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        recency(a.command.id) - recency(b.command.id) ||
        a.order - b.order
    )
    .map(({ command }) => ({
      command,
      keybinds: registry.keybinds(command.id),
      available: !command.available || command.available(context),
    }))
}

/** A run of palette rows under one heading; a search's rows have none. */
export interface PaletteSection<Context> {
  title?: string
  entries: PaletteEntry<Context>[]
}

/**
 * The rows as the palette lays them out. A search is one ranked list, best
 * first. With nothing typed there is nothing to rank by, so the rows are
 * shown as a browsable index: what ran recently, then each category in the
 * registry's order. Each command appears once.
 */
export function paletteSections<Context>(
  registry: Registry<Context>,
  context: Context,
  query: string,
  recent: readonly string[],
  hidden: readonly string[] = []
): PaletteSection<Context>[] {
  const entries = paletteEntries(registry, context, query, recent, hidden)
  if (query.trim()) return [{ entries }]
  // An empty query ranks by recency alone, so the recent rows lead.
  const ran = new Set(recent)
  const sections: PaletteSection<Context>[] = [
    {
      title: "Recent",
      entries: entries.filter((entry) => ran.has(entry.command.id)),
    },
    ...registry.categories().map((category) => ({
      title: category,
      entries: entries.filter(
        (entry) =>
          entry.command.category === category && !ran.has(entry.command.id)
      ),
    })),
  ]
  return sections.filter((section) => section.entries.length)
}

/** The recent list after running a command: it first, the oldest let go. */
export function rememberRecent(
  recent: readonly string[],
  id: string
): string[] {
  return [id, ...recent.filter((other) => other !== id)].slice(0, RECENT_LIMIT)
}

/**
 * Whether a key pressed in the palette's search field closes it: it is the
 * toggle's chord, and not one the field needs for itself. A toggle rebound to
 * a plain letter (or a shifted one, which is its capital) is a letter there
 * like any other, so a search can hold it; one with Cmd, Ctrl or Alt, or a
 * key that a field has no use for, still closes. Escape is the dialog's own
 * and always does.
 */
export function closesPalette<Context>(
  registry: Registry<Context>,
  chord: Chord,
  toggleId: string
): boolean {
  return registry.lookup(chord)?.id === toggleId && !isFieldKey(chord)
}
