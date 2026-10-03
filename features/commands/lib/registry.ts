import { normaliseChord, type Chord } from "./chord"

/**
 * A user-facing action, named once so that every way of reaching it — a key,
 * a button's tooltip, and later the palette — agrees about what it is called
 * and what it is bound to. The context is whatever the owner of the commands
 * can do (dispatch to the engine, flip a panel); the registry never sees it.
 */
export interface Command<Context> {
  id: string
  label: string
  category: string
  /** Whether running would do anything right now. Absent means always. */
  available?: (context: Context) => boolean
  /** `repeat` is whether a held key's auto-repeat is what ran it. */
  run: (context: Context, input?: { repeat: boolean }) => void
  keybinds?: readonly string[]
  /** Whether a held key's auto-repeat runs it again. Absent means it does. */
  repeat?: boolean
  /**
   * Hold-to-use: pressing the chord starts the command and letting go of its
   * key ends it, instead of running it once.
   */
  momentary?: {
    start: (context: Context) => void
    end: (context: Context) => void
  }
}

export interface Registry<Context> {
  get(id: string): Command<Context> | undefined
  list(): readonly Command<Context>[]
  /** A command's chords, normalised; none for a command that has none. */
  keybinds(id: string): readonly Chord[]
  /** The command a chord is bound to, if any. */
  lookup(chord: Chord): Command<Context> | undefined
}

export function createRegistry<Context>(
  commands: readonly Command<Context>[]
): Registry<Context> {
  const byId = new Map<string, Command<Context>>()
  const chords = new Map<string, readonly Chord[]>()
  const byChord = new Map<Chord, Command<Context>>()
  for (const command of commands) {
    if (byId.has(command.id))
      throw new Error(`Command ${command.id} is registered twice.`)
    byId.set(command.id, command)
    const normalised = (command.keybinds ?? []).map(normaliseChord)
    chords.set(command.id, normalised)
    for (const chord of normalised) {
      const owner = byChord.get(chord)
      if (owner)
        throw new Error(
          `${chord} is bound to both ${owner.id} and ${command.id}.`
        )
      byChord.set(chord, command)
    }
  }
  return {
    get: (id) => byId.get(id),
    list: () => commands,
    keybinds: (id) => chords.get(id) ?? [],
    lookup: (chord) => byChord.get(chord),
  }
}
