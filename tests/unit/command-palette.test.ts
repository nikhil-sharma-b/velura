import { describe, expect, test } from "bun:test"
import {
  closesPalette,
  fuzzyScore,
  paletteEntries,
  rememberRecent,
} from "../../features/commands/lib/palette"
import {
  createRegistry,
  type Command,
} from "../../features/commands/lib/registry"

const command = (
  id: string,
  label: string,
  extra: Partial<Command<{ on: boolean }>> = {}
): Command<{ on: boolean }> => ({
  id,
  label,
  category: "Test",
  run: () => {},
  ...extra,
})

describe("fuzzyScore", () => {
  test("matches each word as an abbreviation of a word in the label", () => {
    expect(fuzzyScore("clr lay", "Clear layer")).toBeDefined()
    expect(fuzzyScore("add lyr", "Add layer")).toBeDefined()
    expect(fuzzyScore("ZOOM", "Zoom in")).toBeDefined()
  })

  test("rejects a query whose letters are not in the label in order", () => {
    expect(fuzzyScore("xyz", "Clear layer")).toBeUndefined()
    expect(fuzzyScore("rl", "Clear")).toBeUndefined()
  })

  test("an empty query matches everything", () => {
    expect(fuzzyScore("  ", "Undo")).toBe(0)
  })

  test("a prefix scores above a scattered match", () => {
    expect(fuzzyScore("red", "Redo")!).toBeGreaterThan(
      fuzzyScore("red", "Reset view dial")!
    )
  })
})

describe("paletteEntries", () => {
  const registry = createRegistry([
    command("a", "Undo", { keybinds: ["mod+z"] }),
    command("b", "Redo"),
    command("c", "Zoom in", { available: ({ on }) => on }),
  ])

  test("lists every command with its keybinds and availability", () => {
    const entries = paletteEntries(registry, { on: false }, "", [])
    expect(entries.map((entry) => entry.command.id)).toEqual(["a", "b", "c"])
    expect(entries[0].keybinds).toEqual(["mod+z"])
    expect(entries[2].available).toBe(false)
  })

  test("puts recent commands first, most recent first", () => {
    const entries = paletteEntries(registry, { on: true }, "", ["c", "b"])
    expect(entries.map((entry) => entry.command.id)).toEqual(["c", "b", "a"])
  })

  test("filters by the query, best match first, recent breaking ties", () => {
    const ids = (query: string, recent: string[] = []) =>
      paletteEntries(registry, { on: true }, query, recent).map(
        (entry) => entry.command.id
      )
    expect(ids("zm")).toEqual(["c"])
    expect(ids("do")).toEqual(["a", "b"])
    expect(ids("do", ["b"])).toEqual(["b", "a"])
  })

  test("leaves out commands the palette is told to hide", () => {
    const entries = paletteEntries(registry, { on: true }, "", [], ["a"])
    expect(entries.map((entry) => entry.command.id)).toEqual(["b", "c"])
  })
})

describe("rememberRecent", () => {
  test("moves the run command to the front and keeps a short list", () => {
    expect(rememberRecent(["a", "b"], "b")).toEqual(["b", "a"])
    const long = rememberRecent(["1", "2", "3", "4", "5"], "6")
    expect(long).toEqual(["6", "1", "2", "3", "4"])
  })
})

describe("closesPalette", () => {
  const registry = (keybinds: string[]) =>
    createRegistry([command("palette.toggle", "Command palette", { keybinds })])

  test("a modifier chord bound to the toggle closes it from the search", () => {
    expect(closesPalette(registry(["mod+k"]), "mod+k", "palette.toggle")).toBe(
      true
    )
    expect(closesPalette(registry(["alt+p"]), "alt+p", "palette.toggle")).toBe(
      true
    )
  })

  test("a plain letter bound to the toggle is typed, not a close", () => {
    expect(closesPalette(registry(["l"]), "l", "palette.toggle")).toBe(false)
    // Shift only makes it a capital: still typing.
    expect(
      closesPalette(registry(["shift+l"]), "shift+l", "palette.toggle")
    ).toBe(false)
    expect(closesPalette(registry(["space"]), "space", "palette.toggle")).toBe(
      false
    )
  })

  test("a key that types nothing still closes", () => {
    expect(closesPalette(registry(["f1"]), "f1", "palette.toggle")).toBe(true)
  })

  test("a chord bound to something else does not close it", () => {
    expect(closesPalette(registry(["mod+k"]), "mod+j", "palette.toggle")).toBe(
      false
    )
  })
})
