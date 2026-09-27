import { normaliseChord, type Chord } from "./chord"
import { createRegistry, type Command, type Registry } from "./registry"

/**
 * The artist's changes to the default keybinds, by command id: a command
 * listed has exactly these chords (none, for one unbound), and a command not
 * listed keeps its defaults. Kept sparse, so a default changed in a later
 * release reaches everyone who never touched that command.
 */
export type KeybindOverrides = Readonly<Record<string, readonly Chord[]>>

export type RebindMode = "reassign" | "swap"

/**
 * The defaults with the overrides laid over them. A chord an override claims
 * is taken from any command that has it by default, so stored overrides can
 * never make two commands answer one key; between two overrides claiming the
 * same chord, the command registered first keeps it.
 */
export function applyOverrides<Context>(
  defaults: Registry<Context>,
  overrides: KeybindOverrides
): Registry<Context> {
  const claimed = new Map<Chord, string>()
  for (const command of defaults.list()) {
    for (const chord of overrides[command.id] ?? []) {
      if (!claimed.has(chord)) claimed.set(chord, command.id)
    }
  }
  return createRegistry<Context>(
    defaults.list().map((command): Command<Context> => {
      const override = overrides[command.id]
      const keybinds = override
        ? override.filter((chord) => claimed.get(chord) === command.id)
        : defaults.keybinds(command.id).filter((chord) => !claimed.has(chord))
      return { ...command, keybinds: [...new Set(keybinds)] }
    })
  )
}

/** The other command a chord would be taken from, if any. */
export function conflictFor<Context>(
  registry: Registry<Context>,
  id: string,
  chord: string
): Command<Context> | undefined {
  const owner = registry.lookup(normaliseChord(chord))
  return owner && owner.id !== id ? owner : undefined
}

type Bindings = Map<string, Chord[]>

function effective<Context>(
  defaults: Registry<Context>,
  overrides: KeybindOverrides
): Bindings {
  const registry = applyOverrides(defaults, overrides)
  return new Map(
    defaults
      .list()
      .map((command) => [command.id, [...registry.keybinds(command.id)]])
  )
}

/** Only the commands whose chords differ from their defaults. */
function sparse<Context>(
  defaults: Registry<Context>,
  bindings: Bindings
): KeybindOverrides {
  const overrides: Record<string, readonly Chord[]> = {}
  for (const [id, chords] of bindings) {
    const initial = defaults.keybinds(id)
    const same =
      chords.length === initial.length &&
      chords.every((chord, index) => chord === initial[index])
    if (!same) overrides[id] = chords
  }
  return overrides
}

/**
 * Binds a chord to a command, in place of `replace` or beside its others. A
 * chord another command has is taken from it; with `swap`, that command gets
 * the chord being replaced in its stead, so neither is left without a key.
 */
export function rebind<Context>(
  defaults: Registry<Context>,
  overrides: KeybindOverrides,
  id: string,
  chord: string,
  { replace, mode = "reassign" }: { replace?: Chord; mode?: RebindMode } = {}
): KeybindOverrides {
  const bindings = effective(defaults, overrides)
  const own = bindings.get(id)
  const next = normaliseChord(chord)
  if (!own || own.includes(next)) return sparse(defaults, bindings)
  for (const [other, chords] of bindings) {
    const at = chords.indexOf(next)
    if (other === id || at < 0) continue
    if (mode === "swap" && replace !== undefined) chords.splice(at, 1, replace)
    else chords.splice(at, 1)
  }
  const at = replace === undefined ? -1 : own.indexOf(replace)
  if (at < 0) own.push(next)
  else own.splice(at, 1, next)
  return sparse(defaults, bindings)
}

/** Takes one chord off a command. */
export function unbind<Context>(
  defaults: Registry<Context>,
  overrides: KeybindOverrides,
  id: string,
  chord: Chord
): KeybindOverrides {
  const bindings = effective(defaults, overrides)
  const own = bindings.get(id)
  if (own)
    bindings.set(
      id,
      own.filter((other) => other !== chord)
    )
  return sparse(defaults, bindings)
}

/**
 * Puts a command back on its defaults, taking them back from any command
 * they were given to since.
 */
export function resetCommand<Context>(
  defaults: Registry<Context>,
  overrides: KeybindOverrides,
  id: string
): KeybindOverrides {
  const bindings = effective(defaults, overrides)
  if (!bindings.has(id)) return sparse(defaults, bindings)
  const initial = defaults.keybinds(id)
  for (const [other, chords] of bindings) {
    if (other !== id)
      bindings.set(
        other,
        chords.filter((chord) => !initial.includes(chord))
      )
  }
  bindings.set(id, [...initial])
  return sparse(defaults, bindings)
}

/** Overrides read back from storage, keeping only what is well formed. */
export function parseOverrides(stored: unknown): KeybindOverrides {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {}
  const overrides: Record<string, readonly Chord[]> = {}
  for (const [id, chords] of Object.entries(stored)) {
    if (!Array.isArray(chords)) continue
    overrides[id] = chords
      .filter((chord): chord is string => typeof chord === "string" && !!chord)
      .map(normaliseChord)
  }
  return overrides
}
