import { describe, expect, test } from "bun:test"
import {
  applyOverrides,
  conflictFor,
  parseOverrides,
  rebind,
  resetCommand,
  unbind,
} from "../../features/commands/lib/overrides"
import {
  createRegistry,
  type Command,
} from "../../features/commands/lib/registry"

const command = (id: string, keybinds: string[] = []): Command<null> => ({
  id,
  label: id.toUpperCase(),
  category: "Test",
  run: () => {},
  keybinds,
})

const defaults = createRegistry([
  command("undo", ["mod+z"]),
  command("redo", ["mod+shift+z", "mod+y"]),
  command("brush", ["b"]),
  command("add"),
])

describe("applyOverrides", () => {
  test("no overrides keeps every default", () => {
    const registry = applyOverrides(defaults, {})
    expect(registry.keybinds("redo")).toEqual(["mod+shift+z", "mod+y"])
    expect(registry.lookup("b")?.id).toBe("brush")
  })

  test("an override replaces a command's chords and an empty one unbinds", () => {
    const registry = applyOverrides(defaults, { add: ["N"], brush: [] })
    expect(registry.keybinds("add")).toEqual(["n"])
    expect(registry.lookup("n")?.id).toBe("add")
    expect(registry.keybinds("brush")).toEqual([])
    expect(registry.lookup("b")).toBeUndefined()
  })

  test("an override takes a default chord from the command that had it", () => {
    const registry = applyOverrides(defaults, { add: ["b"] })
    expect(registry.lookup("b")?.id).toBe("add")
    expect(registry.keybinds("brush")).toEqual([])
  })

  test("overrides for unknown commands are ignored", () => {
    const registry = applyOverrides(defaults, { gone: ["q"] })
    expect(registry.lookup("q")).toBeUndefined()
  })

  test("two overrides claiming one chord leave it to the earlier command", () => {
    const registry = applyOverrides(defaults, { add: ["q"], brush: ["q"] })
    expect(registry.lookup("q")?.id).toBe("brush")
    expect(registry.keybinds("add")).toEqual([])
  })
})

describe("rebind", () => {
  test("adds a free chord and keeps the map sparse", () => {
    const next = rebind(defaults, {}, "add", "n")
    expect(next).toEqual({ add: ["n"] })
  })

  test("replaces one chord of several", () => {
    const next = rebind(defaults, {}, "redo", "mod+r", { replace: "mod+y" })
    expect(next).toEqual({ redo: ["mod+shift+z", "mod+r"] })
  })

  test("reassign takes a chord away from its owner", () => {
    const next = rebind(defaults, {}, "add", "b", { mode: "reassign" })
    const registry = applyOverrides(defaults, next)
    expect(registry.lookup("b")?.id).toBe("add")
    expect(registry.keybinds("brush")).toEqual([])
    expect(next).toEqual({ add: ["b"], brush: [] })
  })

  test("swap gives the owner the chord being replaced", () => {
    const next = rebind(defaults, {}, "undo", "b", {
      replace: "mod+z",
      mode: "swap",
    })
    const registry = applyOverrides(defaults, next)
    expect(registry.lookup("b")?.id).toBe("undo")
    expect(registry.lookup("mod+z")?.id).toBe("brush")
  })

  test("swap never gives the owner a chord it already has", () => {
    const next = rebind(defaults, {}, "redo", "mod+z", {
      replace: "mod+y",
      mode: "swap",
    })
    const withBoth = rebind(
      defaults,
      { undo: ["mod+z", "mod+y"] },
      "redo",
      "mod+z",
      {
        replace: "mod+y",
        mode: "swap",
      }
    )
    expect(next.undo).toEqual(["mod+y"])
    expect(withBoth.undo).toEqual(["mod+y"])
  })

  test("swapping back to the defaults leaves no overrides", () => {
    const swapped = rebind(defaults, {}, "undo", "b", {
      replace: "mod+z",
      mode: "swap",
    })
    const back = rebind(defaults, swapped, "undo", "mod+z", {
      replace: "b",
      mode: "swap",
    })
    expect(back).toEqual({})
  })

  test("binding a chord the command already has changes nothing", () => {
    expect(rebind(defaults, {}, "brush", "b")).toEqual({})
  })
})

describe("unbind and reset", () => {
  test("unbind removes one chord", () => {
    expect(unbind(defaults, {}, "redo", "mod+y")).toEqual({
      redo: ["mod+shift+z"],
    })
  })

  test("reset one command drops its override", () => {
    const overrides = { add: ["n"], brush: [] }
    expect(resetCommand(defaults, overrides, "brush")).toEqual({ add: ["n"] })
  })

  test("reset takes a default chord back from whoever was given it", () => {
    const overrides = rebind(defaults, {}, "add", "b")
    const next = resetCommand(defaults, overrides, "brush")
    expect(next).toEqual({})
    expect(applyOverrides(defaults, next).lookup("b")?.id).toBe("brush")
  })
})

describe("conflictFor", () => {
  test("names the other command that owns a chord", () => {
    const registry = applyOverrides(defaults, {})
    expect(conflictFor(registry, "add", "B")?.id).toBe("brush")
    expect(conflictFor(registry, "brush", "b")).toBeUndefined()
    expect(conflictFor(registry, "add", "q")).toBeUndefined()
  })
})

describe("parseOverrides", () => {
  test("keeps well-formed entries and drops the rest", () => {
    expect(
      parseOverrides({ add: ["N", 3], brush: [], bad: "x", worse: null })
    ).toEqual({ add: ["n"], brush: [] })
    expect(parseOverrides("nonsense")).toEqual({})
    expect(parseOverrides(null)).toEqual({})
  })
})
