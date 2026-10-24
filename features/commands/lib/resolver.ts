import { chordFromEvent, chordKey, normaliseKey, type KeyLike } from "./chord"
import type { Command, Registry } from "./registry"

/** The parts of a keyboard event the resolver reads and acts on. */
export interface KeyEventLike extends KeyLike {
  repeat: boolean
  defaultPrevented: boolean
  target: unknown
  preventDefault(): void
}

/** A field being typed in owns its keys, and these are not them. */
export function isTypingTarget(target: unknown): boolean {
  if (!target || typeof target !== "object") return false
  const element = target as { tagName?: string; isContentEditable?: boolean }
  return (
    !!element.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName ?? "")
  )
}

export interface KeybindResolver {
  /** Runs what the key is bound to; true when the key was the resolver's. */
  keydown(event: KeyEventLike): boolean
  keyup(event: KeyEventLike): void
  /** The window lost focus, so no key it was holding will be seen let go. */
  blur(): void
}

export function createKeybindResolver<Context>(
  registry: Registry<Context>,
  context: () => Context
): KeybindResolver {
  let held: { command: Command<Context>; key: string } | undefined

  const end = () => {
    const current = held
    held = undefined
    current?.command.momentary?.end(context())
  }

  const find = (event: KeyEventLike) => {
    const chord = chordFromEvent(event)
    const exact = registry.lookup(chord)
    if (exact) return { command: exact, chord }
    // A modifier pressed while another is already down still starts its own
    // hold: Alt after Cmd is `mod+alt`, but the artist is reaching for Alt.
    const pressed = chordKey(chord)
    if (["mod", "alt", "shift"].includes(pressed)) {
      const alone = registry.lookup(pressed)
      if (alone?.momentary) return { command: alone, chord: pressed }
    }
    // A symbol that needs shift to type (`+`, `)`) arrives shifted, and a key
    // bound without shift should still answer when shift is only how it was
    // reached; a chord that names shift itself is matched exactly above.
    if (!event.shiftKey) return
    const unshifted = chord
      .replace(/(^|\+)shift(?=\+|$)/, "")
      .replace(/^\+/, "")
    const loose = unshifted ? registry.lookup(unshifted) : undefined
    return loose ? { command: loose, chord: unshifted } : undefined
  }

  return {
    keydown(event) {
      // A key a control already handled, such as an arrow on a slider, must
      // not also do what it would do on the canvas.
      if (event.defaultPrevented || isTypingTarget(event.target)) return false
      const found = find(event)
      if (!found) return false
      const { command, chord } = found
      if (command.momentary) {
        if (held?.command === command) return true
        const ctx = context()
        if (command.available && !command.available(ctx)) return false
        end()
        held = { command, key: chordKey(chord) }
        command.momentary.start(ctx)
        return true
      }
      // A command that would do nothing leaves the key to the browser, as it
      // was before there was anything to bind it to.
      const ctx = context()
      if (command.available && !command.available(ctx)) return false
      event.preventDefault()
      if (event.repeat && command.repeat === false) return true
      command.run(ctx, { repeat: event.repeat })
      return true
    },
    keyup(event) {
      if (!held || typeof event.key !== "string") return
      if (normaliseKey(event.key) === held.key) end()
    },
    blur: end,
  }
}
