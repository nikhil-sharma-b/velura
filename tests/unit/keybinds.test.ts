import { describe, expect, mock, test } from "bun:test"
import {
  chordFromEvent,
  formatChord,
  normaliseChord,
} from "../../features/commands/lib/chord"
import {
  createRegistry,
  type Command,
} from "../../features/commands/lib/registry"
import {
  createKeybindResolver,
  type KeyEventLike,
} from "../../features/commands/lib/resolver"

const key = (init: Partial<KeyEventLike> & { key: string }) => ({
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  repeat: false,
  defaultPrevented: false,
  target: null as unknown,
  preventDefault: mock(() => {}),
  ...init,
})

describe("chords", () => {
  test("normalise to one spelling whatever order and alias", () => {
    expect(normaliseChord("Shift+Cmd+Z")).toBe("mod+shift+z")
    expect(normaliseChord("ctrl+shift+z")).toBe("mod+shift+z")
    expect(normaliseChord("Option")).toBe("alt")
    expect(normaliseChord("ArrowLeft")).toBe("arrowleft")
    expect(normaliseChord("Space")).toBe("space")
  })

  test("read from a key event, with Cmd and Ctrl as the same modifier", () => {
    expect(
      chordFromEvent(key({ key: "Z", metaKey: true, shiftKey: true }))
    ).toBe("mod+shift+z")
    expect(chordFromEvent(key({ key: "z", ctrlKey: true }))).toBe("mod+z")
    expect(chordFromEvent(key({ key: " " }))).toBe("space")
  })

  test("a modifier pressed alone is a chord of that modifier", () => {
    expect(chordFromEvent(key({ key: "Alt", altKey: true }))).toBe("alt")
    expect(chordFromEvent(key({ key: "Shift", shiftKey: true }))).toBe("shift")
  })

  test("format per platform", () => {
    expect(formatChord("mod+shift+z", "mac")).toBe("⇧⌘Z")
    expect(formatChord("mod+shift+z", "other")).toBe("Ctrl+Shift+Z")
    expect(formatChord("alt", "mac")).toBe("⌥")
    expect(formatChord("[", "other")).toBe("[")
  })
})

function setup(extra: Command<null>[] = []) {
  const ran: string[] = []
  const registry = createRegistry<null>([
    {
      id: "edit.undo",
      label: "Undo",
      category: "Edit",
      keybinds: ["mod+z"],
      run: () => void ran.push("undo"),
    },
    {
      id: "edit.redo",
      label: "Redo",
      category: "Edit",
      keybinds: ["mod+shift+z", "mod+y"],
      run: () => void ran.push("redo"),
    },
    {
      id: "view.zoomIn",
      label: "Zoom in",
      category: "View",
      keybinds: ["="],
      run: () => void ran.push("zoomIn"),
    },
    {
      id: "view.reset",
      label: "Reset view",
      category: "View",
      keybinds: ["shift+0"],
      run: () => void ran.push("reset"),
    },
    ...extra,
  ])
  const resolver = createKeybindResolver(registry, () => null)
  return { ran, registry, resolver }
}

describe("resolution", () => {
  test("a bound chord runs its command and is consumed", () => {
    const { ran, resolver } = setup()
    const event = key({ key: "z", metaKey: true })
    expect(resolver.keydown(event)).toBe(true)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(ran).toEqual(["undo"])
  })

  test("any of a command's chords reaches it", () => {
    const { ran, resolver } = setup()
    resolver.keydown(key({ key: "Z", ctrlKey: true, shiftKey: true }))
    resolver.keydown(key({ key: "y", ctrlKey: true }))
    expect(ran).toEqual(["redo", "redo"])
  })

  test("an unbound chord is left alone", () => {
    const { ran, resolver } = setup()
    const event = key({ key: "q" })
    expect(resolver.keydown(event)).toBe(false)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(ran).toEqual([])
  })

  test("shift falls away when only the unshifted chord is bound", () => {
    const { ran, resolver } = setup()
    resolver.keydown(key({ key: "=", shiftKey: true }))
    resolver.keydown(key({ key: "0", shiftKey: true }))
    expect(ran).toEqual(["zoomIn", "reset"])
  })

  test("an extra modifier is a different chord", () => {
    const { ran, resolver } = setup()
    resolver.keydown(key({ key: "z", metaKey: true, altKey: true }))
    resolver.keydown(key({ key: "=", metaKey: true }))
    expect(ran).toEqual([])
  })

  test("an unavailable command leaves its key to the browser", () => {
    const { ran, resolver } = setup([
      {
        id: "never",
        label: "Never",
        category: "Test",
        keybinds: ["n"],
        available: () => false,
        run: () => void ran.push("never"),
      },
    ])
    const event = key({ key: "n" })
    expect(resolver.keydown(event)).toBe(false)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(ran).toEqual([])
  })

  test("a command may refuse auto-repeat", () => {
    const { ran, resolver } = setup([
      {
        id: "toggle",
        label: "Toggle",
        category: "Test",
        keybinds: ["d"],
        repeat: false,
        run: () => void ran.push("toggle"),
      },
    ])
    resolver.keydown(key({ key: "d" }))
    resolver.keydown(key({ key: "d", repeat: true }))
    expect(ran).toEqual(["toggle"])
  })

  test("a key a control already handled is not resolved again", () => {
    const { ran, resolver } = setup()
    resolver.keydown(key({ key: "=", defaultPrevented: true }))
    expect(ran).toEqual([])
  })

  test("the registry names the chords a command answers to", () => {
    const { registry } = setup()
    expect(registry.keybinds("edit.redo")).toEqual(["mod+shift+z", "mod+y"])
    expect(registry.keybinds("missing")).toEqual([])
  })
})

describe("text input suppression", () => {
  const field = (tagName: string, isContentEditable = false) =>
    ({ tagName, isContentEditable }) as unknown

  test.each(["INPUT", "TEXTAREA", "SELECT"])("%s keeps its keys", (tag) => {
    const { ran, resolver } = setup()
    expect(resolver.keydown(key({ key: "=", target: field(tag) }))).toBe(false)
    expect(
      resolver.keydown(key({ key: "z", metaKey: true, target: field(tag) }))
    ).toBe(false)
    expect(ran).toEqual([])
  })

  test("contenteditable keeps its keys", () => {
    const { ran, resolver } = setup()
    resolver.keydown(key({ key: "=", target: field("DIV", true) }))
    expect(ran).toEqual([])
  })

  test("other elements do not", () => {
    const { ran, resolver } = setup()
    resolver.keydown(key({ key: "=", target: field("BUTTON") }))
    expect(ran).toEqual(["zoomIn"])
  })
})

describe("momentary bindings", () => {
  function held() {
    const log: string[] = []
    const { resolver } = setup([
      {
        id: "tool.eyedropper",
        label: "Eyedropper",
        category: "Tools",
        keybinds: ["alt"],
        run: () => void log.push("run"),
        momentary: {
          start: () => void log.push("start"),
          end: () => void log.push("end"),
        },
      },
    ])
    return { log, resolver }
  }

  test("hold starts, release ends", () => {
    const { log, resolver } = held()
    resolver.keydown(key({ key: "Alt", altKey: true }))
    resolver.keydown(key({ key: "Alt", altKey: true, repeat: true }))
    expect(log).toEqual(["start"])
    resolver.keyup(key({ key: "Alt" }))
    expect(log).toEqual(["start", "end"])
  })

  test("a hold starts even with another modifier already down", () => {
    const { log, resolver } = held()
    resolver.keydown(key({ key: "Alt", altKey: true, metaKey: true }))
    resolver.keyup(key({ key: "Alt", metaKey: true }))
    expect(log).toEqual(["start", "end"])
  })

  test("releasing some other key does not end the hold", () => {
    const { log, resolver } = held()
    resolver.keydown(key({ key: "Alt", altKey: true }))
    resolver.keyup(key({ key: "z", altKey: true }))
    expect(log).toEqual(["start"])
  })

  test("losing the window ends the hold", () => {
    const { log, resolver } = held()
    resolver.keydown(key({ key: "Alt", altKey: true }))
    resolver.blur()
    resolver.blur()
    expect(log).toEqual(["start", "end"])
  })

  test("a hold never started in a text field", () => {
    const { log, resolver } = held()
    resolver.keydown(
      key({
        key: "Alt",
        altKey: true,
        target: { tagName: "INPUT", isContentEditable: false },
      })
    )
    resolver.keyup(key({ key: "Alt" }))
    expect(log).toEqual([])
  })
})
