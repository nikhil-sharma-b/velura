import { describe, expect, mock, test } from "bun:test"
import type { Engine, EngineCommand, LayerSummary } from "../../engine"
import { createKeybindResolver } from "../../features/commands/lib/resolver"
import {
  runStudioCommand,
  steppedRadius,
  studioCommands,
  type StudioContext,
} from "../../features/studio/lib/studio-commands"

const raster = (id: string, extra: Partial<LayerSummary> = {}) =>
  ({
    id,
    kind: "raster",
    name: id,
    visible: true,
    locked: false,
    clip: false,
    ...extra,
  }) as unknown as LayerSummary

/** An engine that records what it is asked to do, over a fixed layer tree. */
function fakeEngine(
  layers: LayerSummary[],
  activeLayerId = "a",
  extra: Record<string, unknown> = {}
) {
  const sent: EngineCommand[] = []
  const engine = {
    getSnapshot: () => ({
      ...extra,
      layers,
      activeLayerId,
      tool: "brush",
      brush: { shape: { radius: 10 } },
      eraser: { shape: { radius: 10 } },
    }),
    dispatch: mock(async (command: EngineCommand) => void sent.push(command)),
  } as unknown as Engine
  return { engine, sent }
}

function context(engine: Engine, layerId?: string): StudioContext {
  return {
    engine,
    layerId,
    historyBusy: () => false,
    occludedRight: () => 0,
    setSampling: () => {},
    togglePalette: () => {},
    openPreferences: () => {},
    toggleZen: () => {},
  }
}

describe("layer commands", () => {
  test("act on the layer they are given", () => {
    const { engine, sent } = fakeEngine([raster("a"), raster("b")])
    runStudioCommand("layer.delete", context(engine, "b"))
    runStudioCommand("layer.duplicate", context(engine, "b"))
    expect(sent).toEqual([
      { type: "removeLayer", id: "b" },
      { type: "duplicateLayer", id: "b" },
    ])
  })

  test("act on the active layer when given none", () => {
    const { engine, sent } = fakeEngine([raster("a"), raster("b")], "b")
    runStudioCommand("layer.toggleVisible", context(engine))
    runStudioCommand("layer.toggleLock", context(engine))
    expect(sent).toEqual([
      { type: "setLayer", id: "b", visible: false },
      { type: "setLayer", id: "b", locked: true },
    ])
  })

  test("find layers inside groups", () => {
    const group = {
      id: "g",
      kind: "group",
      name: "g",
      visible: true,
      children: [raster("a"), raster("b", { visible: false })],
    } as unknown as LayerSummary
    const { engine, sent } = fakeEngine([group])
    runStudioCommand("layer.toggleVisible", context(engine, "b"))
    expect(sent).toEqual([{ type: "setLayer", id: "b", visible: true }])
  })

  test("the last paintable layer cannot be deleted", () => {
    const { engine, sent } = fakeEngine([raster("a")])
    const command = studioCommands.get("layer.delete")!
    expect(command.available!(context(engine, "a"))).toBe(false)
    runStudioCommand("layer.delete", context(engine, "a"))
    expect(sent).toEqual([])
  })

  test("only a raster layer can be duplicated or locked", () => {
    const group = {
      id: "g",
      kind: "group",
      name: "g",
      visible: true,
      children: [raster("a")],
    } as unknown as LayerSummary
    const { engine } = fakeEngine([group, raster("b")])
    for (const id of ["layer.duplicate", "layer.toggleLock"])
      expect(studioCommands.get(id)!.available!(context(engine, "g"))).toBe(
        false
      )
  })

  test("clear empties the active paintable layer", () => {
    const { engine, sent } = fakeEngine([raster("a"), raster("b")], "b")
    runStudioCommand("layer.clear", context(engine))
    expect(sent).toEqual([{ type: "clearLayer", id: "b" }])
  })

  test("clear is not offered on a locked layer, an image or a group", () => {
    const group = {
      id: "g",
      kind: "group",
      name: "g",
      visible: true,
      children: [raster("a")],
    } as unknown as LayerSummary
    const { engine } = fakeEngine([
      group,
      raster("locked", { locked: true }),
      raster("photo", { image: true } as Partial<LayerSummary>),
    ])
    for (const id of ["g", "locked", "photo"])
      expect(
        studioCommands.get("layer.clear")!.available!(context(engine, id))
      ).toBe(false)
  })

  test("a layer that is not there is not acted on", () => {
    const { engine, sent } = fakeEngine([raster("a"), raster("b")])
    runStudioCommand("layer.delete", context(engine, "missing"))
    expect(sent).toEqual([])
  })
})

describe("default keys", () => {
  const press = (key: string, shiftKey = false) => {
    const { engine, sent } = fakeEngine([raster("a")])
    createKeybindResolver(studioCommands, () => context(engine)).keydown({
      key,
      shiftKey,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      repeat: false,
      defaultPrevented: false,
      target: null,
      preventDefault: () => {},
    })
    return sent.map((command) => command.type)
  }

  test("keep the keys the studio always had", () => {
    expect(press("0")).toEqual(["fitView"])
    expect(press("0", true)).toEqual(["resetView"])
    expect(press(")", true)).toEqual(["resetView"])
    expect(press("+", true)).toEqual(["zoomView"])
    expect(press("_", true)).toEqual(["zoomView"])
    expect(press("<", true)).toEqual(["rotateView"])
    expect(press("H", true)).toEqual(["flipView"])
    expect(press("ArrowLeft", true)).toEqual(["panView"])
    expect(press("]")).toEqual(["setBrush"])
  })
})

describe("size steps", () => {
  test("multiply, but never by less than half a pixel", () => {
    expect(steppedRadius(100, 1)).toBeCloseTo(115)
    expect(steppedRadius(1, 1)).toBe(1.5)
    expect(steppedRadius(1, -1)).toBe(0.5)
  })

  test("stop at the bounds", () => {
    expect(steppedRadius(0.5, -1)).toBeUndefined()
    expect(steppedRadius(200, 1)).toBeUndefined()
    expect(steppedRadius(190, 1)).toBe(200)
  })
})

describe("zen mode", () => {
  test("f toggles it, once per press", () => {
    const { engine } = fakeEngine([raster("a")])
    const toggleZen = mock(() => {})
    const resolver = createKeybindResolver(studioCommands, () => ({
      ...context(engine),
      toggleZen,
    }))
    const press = (repeat: boolean) => {
      const preventDefault = mock(() => {})
      resolver.keydown({
        key: "f",
        shiftKey: false,
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        repeat,
        defaultPrevented: false,
        target: null,
        preventDefault,
      })
      return preventDefault
    }
    expect(press(false)).toHaveBeenCalled()
    press(true)
    expect(toggleZen).toHaveBeenCalledTimes(1)
  })
})

describe("selection commands", () => {
  const press = (
    key: string,
    modifiers: { shift?: boolean; mod?: boolean }
  ) => {
    const { engine, sent } = fakeEngine([raster("a")])
    createKeybindResolver(studioCommands, () => context(engine)).keydown({
      key,
      shiftKey: !!modifiers.shift,
      metaKey: false,
      ctrlKey: !!modifiers.mod,
      altKey: false,
      repeat: false,
      defaultPrevented: false,
      target: null,
      preventDefault: () => {},
    })
    return sent
  }

  test("m picks the rectangle and shift+m the ellipse", () => {
    expect(press("m", {})).toEqual([{ type: "setTool", tool: "rectSelect" }])
    expect(press("M", { shift: true })).toEqual([
      { type: "setTool", tool: "ellipseSelect" },
    ])
  })

  test("l picks the freehand lasso and shift+l the polygonal one", () => {
    expect(press("l", {})).toEqual([{ type: "setTool", tool: "lasso" }])
    expect(press("L", { shift: true })).toEqual([
      { type: "setTool", tool: "polygonLasso" },
    ])
  })

  test("w picks the magic wand", () => {
    expect(press("w", {})).toEqual([{ type: "setTool", tool: "magicWand" }])
  })

  test("shift+v picks the move-outline tool", () => {
    expect(press("V", { shift: true })).toEqual([
      { type: "setTool", tool: "moveSelection" },
    ])
  })

  test("mod+j copies the selection to a new layer", () => {
    expect(press("j", { mod: true })).toEqual([
      { type: "copySelectionToLayer" },
    ])
  })

  test("escape abandons an outline being drawn", () => {
    expect(press("Escape", {})).toEqual([{ type: "abandonSelectionGesture" }])
  })

  test("select all, deselect and invert have their usual keys", () => {
    expect(press("a", { mod: true })).toEqual([{ type: "selectAll" }])
    expect(press("d", { mod: true })).toEqual([{ type: "deselect" }])
    expect(press("I", { mod: true, shift: true })).toEqual([
      { type: "invertSelection" },
    ])
  })
})

describe("snapping and alignment", () => {
  test("align commands line the layer up with the canvas", () => {
    const { engine, sent } = fakeEngine([raster("a"), raster("b")], "b")
    for (const anchor of [
      "left",
      "hcenter",
      "right",
      "top",
      "vcenter",
      "bottom",
    ])
      runStudioCommand(`layer.align.canvas.${anchor}`, context(engine))
    expect(sent).toEqual(
      ["left", "hcenter", "right", "top", "vcenter", "bottom"].map(
        (anchor) => ({ type: "alignLayer", id: "b", anchor, to: "canvas" })
      ) as EngineCommand[]
    )
  })

  test("aligning to the selection needs a selection", () => {
    const without = fakeEngine([raster("a")])
    runStudioCommand("layer.align.selection.left", context(without.engine))
    expect(without.sent).toEqual([])
    const withSelection = fakeEngine([raster("a")], "a", {
      selection: { bounds: { x: 0, y: 0, width: 5, height: 5 } },
    })
    runStudioCommand(
      "layer.align.selection.left",
      context(withSelection.engine)
    )
    expect(withSelection.sent).toEqual([
      { type: "alignLayer", id: "a", anchor: "left", to: "selection" },
    ])
  })

  test("groups are not aligned", () => {
    const group = {
      id: "g",
      kind: "group",
      name: "g",
      visible: true,
      children: [raster("a")],
    } as unknown as LayerSummary
    const { engine, sent } = fakeEngine([group])
    runStudioCommand("layer.align.canvas.left", context(engine, "g"))
    expect(sent).toEqual([])
  })

  test("the snapping toggle flips what the engine holds", () => {
    const on = fakeEngine([raster("a")], "a", { snapping: true })
    runStudioCommand("view.toggleSnapping", context(on.engine))
    const off = fakeEngine([raster("a")], "a", { snapping: false })
    runStudioCommand("view.toggleSnapping", context(off.engine))
    expect([...on.sent, ...off.sent]).toEqual([
      { type: "setSnapping", enabled: false },
      { type: "setSnapping", enabled: true },
    ])
  })
})
