/**
 * A chord is a key combination spelled one way: modifiers in a fixed order
 * (`mod`, `alt`, `shift`), then the key, lowercase, joined with `+`. `mod` is
 * Cmd on a Mac and Ctrl elsewhere, so one default serves both keyboards.
 * A modifier pressed on its own is a chord of just that modifier (`alt`),
 * which is what a hold-to-use binding waits for.
 */
export type Chord = string

export type Platform = "mac" | "other"

/** The parts of a key event a chord is read from. */
export interface KeyLike {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}

export const MODIFIERS = ["mod", "alt", "shift"] as const

const ALIASES: Record<string, string> = {
  cmd: "mod",
  command: "mod",
  meta: "mod",
  ctrl: "mod",
  control: "mod",
  option: "alt",
  " ": "space",
  esc: "escape",
}

/** One key's name, as a chord spells it. */
export function normaliseKey(key: string): string {
  const lower = key.toLowerCase()
  return ALIASES[lower] ?? lower
}

export function normaliseChord(chord: string): Chord {
  // A bare "+" is a key, not an empty pair of parts.
  const parts = chord === "+" ? ["+"] : chord.split("+").filter(Boolean)
  const names = parts.map(normaliseKey)
  const modifiers = MODIFIERS.filter((modifier) => names.includes(modifier))
  const rest = names.filter(
    (name) => !(MODIFIERS as readonly string[]).includes(name)
  )
  return [...modifiers, ...rest].join("+")
}

export function chordFromEvent(event: KeyLike): Chord {
  // Chrome's autofill dispatches a keydown with no `key` at all when a saved
  // entry is picked, whatever the type says.
  const key = typeof event.key === "string" ? normaliseKey(event.key) : ""
  const parts: string[] = []
  if (event.metaKey || event.ctrlKey || key === "mod") parts.push("mod")
  if (event.altKey || key === "alt") parts.push("alt")
  if (event.shiftKey || key === "shift") parts.push("shift")
  if (key && !(MODIFIERS as readonly string[]).includes(key)) parts.push(key)
  return parts.join("+")
}

/** The last part of a chord: the key that is pressed, or held, to fire it. */
export function chordKey(chord: Chord): string {
  const parts = chord === "+" ? ["+"] : chord.split("+")
  return parts[parts.length - 1] || "+"
}

const MAC_NAMES: Record<string, string> = {
  mod: "⌘",
  alt: "⌥",
  shift: "⇧",
}
const OTHER_NAMES: Record<string, string> = {
  mod: "Ctrl",
  alt: "Alt",
  shift: "Shift",
}
const KEY_NAMES: Record<string, string> = {
  arrowleft: "←",
  arrowright: "→",
  arrowup: "↑",
  arrowdown: "↓",
  space: "Space",
  escape: "Esc",
  enter: "Enter",
  tab: "Tab",
  backspace: "Backspace",
  delete: "Delete",
}

/**
 * A chord as a person reads it: Mac symbols in Apple's order (⇧ before ⌘),
 * and words joined with `+` everywhere else.
 */
export function formatChord(chord: Chord, platform: Platform): string {
  const parts = chord === "+" ? ["+"] : chord.split("+")
  const names = platform === "mac" ? MAC_NAMES : OTHER_NAMES
  const modifiers = parts.filter((part) => part in names)
  const keys = parts
    .filter((part) => !(part in names))
    .map((part) => KEY_NAMES[part] ?? part.toUpperCase())
  if (platform === "mac") {
    const order = ["alt", "shift", "mod"]
    modifiers.sort((a, b) => order.indexOf(a) - order.indexOf(b))
    return [...modifiers.map((part) => names[part]), ...keys].join("")
  }
  return [...modifiers.map((part) => names[part]), ...keys].join("+")
}

export function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "other"
  return /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent)
    ? "mac"
    : "other"
}
