import {
  FILTER_LABELS,
  type AlignAnchor,
  type Engine,
  type EngineCommand,
  type FilterKind,
  type LayerSummary,
} from "@/engine"
import { createRegistry, type Command } from "@/features/commands/lib/registry"

import { findSummary, leafCount } from "./layer-tree"
import { writeRulersVisible } from "./ruler-preference"

/** One press of a zoom key or button, which is a comfortable step by eye. */
export const ZOOM_STEP = 1.25
/** One press of a rotate key: fifteen degrees, so a quarter turn is six. */
export const ROTATE_STEP = Math.PI / 12
/** One press of an arrow key, in CSS pixels: a nudge, not a leap. */
const PAN_STEP = 40
/**
 * One press of a size key. Multiplicative, because the step an artist wants
 * between 2px and 3px is not the step they want between 100px and 101px.
 */
const SIZE_STEP = 1.15
/** The radius bounds the size slider offers, so the keys cannot leave them. */
export const MIN_RADIUS = 0.5
export const MAX_RADIUS = 200

/** What the studio's commands act on, read fresh each time one runs. */
export interface StudioContext {
  engine: Engine | null
  /**
   * The layer a layer command acts on: the row whose button was pressed, or,
   * from a key, the active layer.
   */
  layerId?: string
  /**
   * A version being opened or taken back is itself an undo step in flight;
   * another on top would race it.
   */
  historyBusy: () => boolean
  /** How much of the right of the window fitting and resetting leaves clear. */
  occludedRight: () => number
  /** The eyedropper is held: the next click on the canvas samples. */
  setSampling: (sampling: boolean) => void
  /** Opens the command palette, or closes it when it is open. */
  togglePalette: () => void
  /** Opens the preferences panel. */
  openPreferences: () => void
  /** Hides every control so only the canvas is left, or brings them back. */
  toggleZen: () => void
  /**
   * Opens the feather dialog (04), which asks how far to feather the
   * selection and feathers it once the artist says; cancelling asks nothing
   * of the engine.
   */
  openFeather: () => void
  /**
   * Asks the artist to confirm emptying a layer, and clears it only once they
   * do; cancelling asks nothing of the engine.
   */
  confirmClear: (layer: LayerSummary) => void
  /** As `confirmClear`, for deleting a layer or a group. */
  confirmDelete: (layer: LayerSummary) => void
}

type StudioCommand = Command<StudioContext>

/** The command that opens the palette, which the palette itself leaves out. */
export const PALETTE_COMMAND = "palette.toggle"

const hasEngine = ({ engine }: StudioContext) => !!engine

function dispatching(
  command: EngineCommand | ((context: StudioContext) => EngineCommand)
): Pick<StudioCommand, "available" | "run"> {
  return {
    available: hasEngine,
    run: (context) =>
      void context.engine?.dispatch(
        typeof command === "function" ? command(context) : command
      ),
  }
}

/** A command for the node tool only, so its keys stay free elsewhere. */
function onNodeTool(
  command: EngineCommand
): Pick<StudioCommand, "available" | "run"> {
  return {
    ...dispatching(command),
    available: ({ engine }) =>
      !!engine &&
      engine.getSnapshot().tool === "node" &&
      engine.getSnapshot().vectorPaths.length > 0,
  }
}

function onVectorSelection(
  command: EngineCommand
): Pick<StudioCommand, "available" | "run"> {
  return {
    ...dispatching(command),
    available: ({ engine }) => {
      if (!engine) return false
      const snapshot = engine.getSnapshot()
      const layer = findSummary(snapshot.layers, snapshot.activeLayerId)
      return (
        layer?.kind === "vector" &&
        !layer.locked &&
        snapshot.vectorSelection.length > 0
      )
    },
  }
}

/** The layer a layer command acts on, if it is still there. */
function targetLayer({ engine, layerId }: StudioContext) {
  if (!engine) return
  const snapshot = engine.getSnapshot()
  return findSummary(snapshot.layers, layerId ?? snapshot.activeLayerId)
}

/**
 * A command on one layer, available while that layer exists and passes
 * `applies`; the layer is looked up when it runs, never closed over.
 */
function onLayer(
  command: (layer: LayerSummary) => EngineCommand,
  applies: (layer: LayerSummary, context: StudioContext) => boolean = () => true
): Pick<StudioCommand, "available" | "run"> {
  return {
    available: (context) => {
      const layer = targetLayer(context)
      return !!layer && applies(layer, context)
    },
    run: (context) => {
      const layer = targetLayer(context)
      if (layer) void context.engine?.dispatch(command(layer))
    },
  }
}

const isRaster = (layer: LayerSummary) => layer.kind === "raster"
/** A layer with pixels of its own, raster or vector: anything but a group. */
const isLeaf = (layer: LayerSummary) => layer.kind !== "group"
/** A layer whose own pixels the artist may change: not locked, not an image. */
const isPaintable = (layer: LayerSummary) =>
  layer.kind === "raster" && !layer.locked && !layer.image

export const ALIGN_ANCHORS: readonly [AlignAnchor, string][] = [
  ["left", "left edges"],
  ["hcenter", "horizontal centres"],
  ["right", "right edges"],
  ["top", "top edges"],
  ["vcenter", "vertical centres"],
  ["bottom", "bottom edges"],
]

/**
 * Align commands (15): each anchor against the canvas, and against the
 * selection while there is one. A group has no pixels of its own to move.
 */
function alignCommands(): StudioCommand[] {
  return (["canvas", "selection"] as const).flatMap((to) =>
    ALIGN_ANCHORS.map(([anchor, lines]) => ({
      id: `layer.align.${to}.${anchor}`,
      label: `Align ${lines} to ${to}`,
      category: "Layers",
      ...onLayer(
        (layer): EngineCommand => ({
          type: "alignLayer",
          id: layer.id,
          anchor,
          to,
        }),
        (layer, { engine }) =>
          isRaster(layer) &&
          (to === "canvas" || !!engine?.getSnapshot().selection)
      ),
    }))
  )
}

/**
 * The radius one press of a size key steps to, from the one in the hand, or
 * nothing when it is already at the bound.
 */
export function steppedRadius(
  radius: number,
  direction: 1 | -1
): number | undefined {
  const next = direction > 0 ? radius * SIZE_STEP : radius / SIZE_STEP
  // A step that rounds back to where it started would make the key look dead
  // at the small end, where the multiplicative step is under half a pixel.
  const nudged =
    direction > 0 ? Math.max(next, radius + 0.5) : Math.min(next, radius - 0.5)
  const clamped = Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, nudged))
  return clamped === radius ? undefined : clamped
}

/**
 * Size is read from the engine rather than closed over, so holding the key
 * steps from the size the last press left rather than repeating one.
 */
function resize(direction: 1 | -1): Pick<StudioCommand, "run" | "available"> {
  return {
    available: hasEngine,
    run: ({ engine }) => {
      if (!engine) return
      const current = engine.getSnapshot()
      const eraser = current.tool === "eraser"
      const tip = eraser ? current.eraser : current.brush
      const radius = steppedRadius(tip.shape.radius, direction)
      if (radius === undefined) return
      void engine.dispatch({
        type: eraser ? "setEraser" : "setBrush",
        radius,
      })
    },
  }
}

/**
 * Every action the studio offers, in one place. Navigation and size are
 * unmodified keys: the hand that reaches for them is the one not holding the
 * pen, and it should not have to hold a modifier too.
 */
export const studioCommands = createRegistry<StudioContext>([
  {
    id: PALETTE_COMMAND,
    label: "Command palette",
    category: "General",
    keybinds: ["mod+k"],
    repeat: false,
    run: ({ togglePalette }) => togglePalette(),
  },
  {
    id: "preferences.open",
    label: "Preferences",
    category: "General",
    keybinds: ["mod+,"],
    repeat: false,
    run: ({ openPreferences }) => openPreferences(),
  },
  {
    // F, where Photoshop cycles its screen modes. Not Tab: in a browser Tab
    // is how the keyboard moves between the controls, and zen should not
    // cost anyone that.
    id: "view.zen",
    label: "Zen mode",
    category: "View",
    keybinds: ["f"],
    repeat: false,
    run: ({ toggleZen }) => toggleZen(),
  },
  {
    id: "edit.undo",
    label: "Undo",
    category: "Edit",
    keybinds: ["mod+z"],
    available: (context) => !!context.engine && !context.historyBusy(),
    run: ({ engine }) => void engine?.dispatch({ type: "undo" }),
  },
  {
    id: "edit.redo",
    label: "Redo",
    category: "Edit",
    keybinds: ["mod+shift+z", "mod+y", "mod+shift+y"],
    available: (context) => !!context.engine && !context.historyBusy(),
    run: ({ engine }) => void engine?.dispatch({ type: "redo" }),
  },
  {
    id: "tool.brush",
    label: "Brush tool",
    category: "Tools",
    keybinds: ["b"],
    ...dispatching({ type: "setTool", tool: "brush" }),
  },
  {
    id: "tool.eraser",
    label: "Eraser tool",
    category: "Tools",
    keybinds: ["e"],
    ...dispatching({ type: "setTool", tool: "eraser" }),
  },
  {
    // M, the marquee in every editor the hand learned on; Shift for the
    // ellipse, since there is no second marquee key to cycle to.
    id: "tool.rectSelect",
    label: "Rectangle select tool",
    category: "Tools",
    keybinds: ["m"],
    ...dispatching({ type: "setTool", tool: "rectSelect" }),
  },
  {
    id: "tool.ellipseSelect",
    label: "Ellipse select tool",
    category: "Tools",
    keybinds: ["shift+m"],
    ...dispatching({ type: "setTool", tool: "ellipseSelect" }),
  },
  {
    // L for the lasso, as M is for the marquee; Shift for the polygonal one.
    id: "tool.lasso",
    label: "Lasso tool",
    category: "Tools",
    keybinds: ["l"],
    ...dispatching({ type: "setTool", tool: "lasso" }),
  },
  {
    id: "tool.polygonLasso",
    label: "Polygonal lasso tool",
    category: "Tools",
    keybinds: ["shift+l"],
    ...dispatching({ type: "setTool", tool: "polygonLasso" }),
  },
  {
    // W, the wand in every editor the hand learned on.
    id: "tool.magicWand",
    label: "Magic wand tool",
    category: "Tools",
    keybinds: ["w"],
    ...dispatching({ type: "setTool", tool: "magicWand" }),
  },
  {
    // Shift+V: V is the move tool elsewhere, and this moves only the outline.
    id: "tool.moveSelection",
    label: "Move selection outline tool",
    category: "Tools",
    keybinds: ["shift+v"],
    ...dispatching({ type: "setTool", tool: "moveSelection" }),
  },
  {
    // U, the shape tool in every editor the hand learned on.
    id: "tool.rectangle",
    label: "Rectangle tool",
    category: "Tools",
    keybinds: ["u"],
    ...dispatching({ type: "setTool", tool: "rectangle" }),
  },
  {
    id: "tool.ellipse",
    label: "Ellipse tool",
    category: "Tools",
    ...dispatching({ type: "setTool", tool: "ellipse" }),
  },
  {
    id: "tool.line",
    label: "Line tool",
    category: "Tools",
    ...dispatching({ type: "setTool", tool: "line" }),
  },
  {
    id: "tool.polygon",
    label: "Polygon tool",
    category: "Tools",
    ...dispatching({ type: "setTool", tool: "polygon" }),
  },
  {
    id: "tool.pen",
    label: "Pen tool",
    category: "Tools",
    keybinds: ["p"],
    ...dispatching({ type: "setTool", tool: "pen" }),
  },
  {
    id: "tool.node",
    label: "Node tool",
    category: "Tools",
    keybinds: ["n"],
    ...dispatching({ type: "setTool", tool: "node" }),
  },
  {
    id: "node.next",
    label: "Select next node",
    category: "Tools",
    keybinds: ["tab"],
    ...onNodeTool({ type: "stepVectorNode", direction: 1 }),
  },
  {
    id: "node.previous",
    label: "Select previous node",
    category: "Tools",
    keybinds: ["shift+tab"],
    ...onNodeTool({ type: "stepVectorNode", direction: -1 }),
  },
  {
    id: "tool.pressure",
    label: "Vector brush tool",
    category: "Tools",
    ...dispatching({ type: "setTool", tool: "pressure" }),
  },
  {
    id: "path.finish",
    label: "Finish open pen path",
    category: "Tools",
    ...dispatching({ type: "finishPenPath" }),
    available: ({ engine }) =>
      !!engine &&
      engine.getSnapshot().tool === "pen" &&
      engine.getSnapshot().penNodes.length >= 2,
  },
  {
    id: "path.closePolygon",
    label: "Close polygon",
    category: "Tools",
    keybinds: ["enter"],
    ...dispatching({ type: "closePolygon" }),
    available: ({ engine }) =>
      !!engine && engine.getSnapshot().tool === "polygon",
  },
  {
    id: "node.delete",
    label: "Delete selected anchor",
    category: "Tools",
    ...dispatching({ type: "deleteVectorNode" }),
  },
  {
    id: "node.toggle",
    label: "Toggle smooth or corner anchor",
    category: "Tools",
    ...dispatching({ type: "toggleVectorNode" }),
  },
  {
    id: "tool.objectSelect",
    label: "Select objects tool",
    category: "Tools",
    ...dispatching({ type: "setTool", tool: "objectSelect" }),
  },
  {
    id: "object.transform",
    label: "Transform objects",
    category: "Tools",
    ...onVectorSelection({ type: "beginVectorTransform" }),
  },
  {
    id: "object.duplicate",
    label: "Duplicate objects",
    category: "Tools",
    ...onVectorSelection({ type: "duplicateVectorObjects" }),
  },
  {
    id: "object.delete",
    label: "Delete objects",
    category: "Tools",
    keybinds: ["delete", "backspace"],
    ...onVectorSelection({ type: "deleteVectorObjects" }),
  },
  {
    // Escape lets go of an outline half drawn, the polygonal lasso's above
    // all, as it does in every editor with one.
    id: "select.abandonOutline",
    label: "Abandon selection outline",
    category: "Select",
    keybinds: ["escape"],
    ...dispatching({ type: "abandonSelectionGesture" }),
  },
  {
    id: "select.all",
    label: "Select all",
    category: "Select",
    keybinds: ["mod+a"],
    ...dispatching({ type: "selectAll" }),
  },
  {
    id: "select.deselect",
    label: "Deselect",
    category: "Select",
    keybinds: ["mod+d"],
    ...dispatching({ type: "deselect" }),
  },
  {
    id: "select.invert",
    label: "Invert selection",
    category: "Select",
    keybinds: ["mod+shift+i"],
    ...dispatching({ type: "invertSelection" }),
  },
  {
    // Unbound by default: shift+f6 elsewhere, which no hand reaches for.
    id: "select.feather",
    label: "Feather selection",
    category: "Select",
    available: ({ engine }) => !!engine?.getSnapshot().selection,
    run: (context) => context.openFeather(),
  },
  {
    // Layer via copy, on the key every editor the hand learned on gives it.
    id: "select.copyToLayer",
    label: "Copy selection to new layer",
    category: "Select",
    keybinds: ["mod+j"],
    ...dispatching({ type: "copySelectionToLayer" }),
  },
  {
    // A held modifier rather than a tool (D-input): the canvas samples while
    // it is down, and painting resumes the moment it is let go.
    id: "tool.eyedropper",
    label: "Eyedropper",
    category: "Tools",
    keybinds: ["alt"],
    run: () => {},
    momentary: {
      start: ({ setSampling }) => setSampling(true),
      end: ({ setSampling }) => setSampling(false),
    },
  },
  // The brackets, because that is where every hand trained on Photoshop,
  // Procreate, Krita or Clip Studio already reaches — a size change is the
  // adjustment made most often, and it should not cost a trip to a panel.
  {
    id: "brush.sizeUp",
    label: "Increase brush size",
    category: "Brush",
    keybinds: ["]"],
    ...resize(1),
  },
  {
    id: "brush.sizeDown",
    label: "Decrease brush size",
    category: "Brush",
    keybinds: ["["],
    ...resize(-1),
  },
  {
    id: "layer.add",
    label: "Add layer",
    category: "Layers",
    ...dispatching({ type: "addLayer" }),
  },
  {
    id: "layer.addVector",
    label: "Add vector layer",
    category: "Layers",
    ...dispatching({ type: "addVectorLayer" }),
  },
  {
    id: "layer.group",
    label: "Group active layer",
    category: "Layers",
    ...dispatching({ type: "addGroup" }),
  },
  {
    id: "layer.duplicate",
    label: "Duplicate layer",
    category: "Layers",
    ...onLayer((layer) => ({ type: "duplicateLayer", id: layer.id }), isLeaf),
  },
  {
    id: "layer.clear",
    label: "Clear layer",
    category: "Layers",
    ...onLayer(
      (layer) => ({ type: "clearLayer", id: layer.id }),
      (layer) =>
        (layer.kind === "vector" && !layer.locked) || isPaintable(layer)
    ),
    // Clearing wipes every mark on the layer, so it waits for a yes.
    run: (context) => {
      const layer = targetLayer(context)
      if (layer) context.confirmClear(layer)
    },
  },
  // Filters (18) open on the layer and wait in a dialog for their settings;
  // the dialog is the engine's open filter, not a state of its own.
  ...(Object.keys(FILTER_LABELS) as FilterKind[]).map(
    (kind): StudioCommand => ({
      id: `filter.${kind}`,
      label: `${FILTER_LABELS[kind]}…`,
      category: "Filters",
      ...onLayer(
        (layer) => ({ type: "beginFilter", id: layer.id, kind }),
        isPaintable
      ),
    })
  ),
  {
    // The document keeps at least one layer to paint on, so the last one
    // left — alone or inside a group — cannot go.
    id: "layer.delete",
    label: "Delete layer",
    category: "Layers",
    ...onLayer(
      (layer) => ({ type: "removeLayer", id: layer.id }),
      (layer, { engine }) => {
        const removed = layer.kind === "group" ? leafCount(layer.children) : 1
        return leafCount(engine!.getSnapshot().layers) > removed
      }
    ),
    // Deleting takes the layer and all on it, so it waits for a yes.
    run: (context) => {
      const layer = targetLayer(context)
      if (layer) context.confirmDelete(layer)
    },
  },
  {
    id: "layer.toggleVisible",
    label: "Show or hide layer",
    category: "Layers",
    ...onLayer((layer) => ({
      type: "setLayer",
      id: layer.id,
      visible: !layer.visible,
    })),
  },
  {
    id: "layer.toggleLock",
    label: "Lock or unlock layer",
    category: "Layers",
    ...onLayer(
      (layer) => ({
        type: "setLayer",
        id: layer.id,
        locked: !(layer.kind !== "group" && layer.locked),
      }),
      isLeaf
    ),
  },
  {
    id: "layer.toggleClip",
    label: "Clip to layer below",
    category: "Layers",
    ...onLayer((layer) => ({
      type: "setLayer",
      id: layer.id,
      clip: !layer.clip,
    })),
  },
  {
    // A layer without a mask gets one; one with a mask starts painting it.
    id: "layer.mask",
    label: "Add or paint mask",
    category: "Layers",
    ...onLayer(
      (layer) => ({
        type: layer.mask ? "selectMask" : "addMask",
        id: layer.id,
      }),
      isLeaf
    ),
  },
  {
    id: "layer.toggleMask",
    label: "Enable or disable mask",
    category: "Layers",
    ...onLayer(
      (layer) => ({
        type: "setMaskEnabled",
        id: layer.id,
        enabled: !layer.mask?.enabled,
      }),
      (layer) => !!layer.mask
    ),
  },
  {
    id: "layer.removeMask",
    label: "Remove mask",
    category: "Layers",
    ...onLayer(
      (layer) => ({ type: "removeMask", id: layer.id }),
      (layer) => !!layer.mask
    ),
  },
  {
    id: "layer.transformImage",
    label: "Move, scale or rotate image",
    category: "Layers",
    ...onLayer(
      (layer) => ({ type: "beginImageTransform", id: layer.id }),
      (layer) => layer.kind === "raster" && !!layer.image && !!layer.placed
    ),
  },
  {
    id: "layer.transform",
    label: "Move, scale or rotate layer",
    category: "Layers",
    keybinds: ["mod+t"],
    ...onLayer(
      (layer) => ({ type: "beginLayerTransform", id: layer.id }),
      (layer) => layer.kind === "raster" && !layer.image
    ),
  },
  {
    id: "layer.flipHorizontal",
    label: "Flip layer horizontally",
    category: "Layers",
    ...onLayer(
      (layer) => ({ type: "flipLayer", id: layer.id, axis: "horizontal" }),
      (layer) => layer.kind === "raster" && !layer.image
    ),
  },
  {
    id: "layer.flipVertical",
    label: "Flip layer vertically",
    category: "Layers",
    ...onLayer(
      (layer) => ({ type: "flipLayer", id: layer.id, axis: "vertical" }),
      (layer) => layer.kind === "raster" && !layer.image
    ),
  },
  ...alignCommands(),
  {
    id: "layer.makePaintable",
    label: "Paint on image (changes the photo)",
    category: "Layers",
    ...onLayer(
      (layer) => ({ type: "makeLayerPaintable", id: layer.id }),
      (layer) => layer.kind === "raster" && !!layer.image
    ),
  },
  {
    id: "layer.rasterise",
    label: "Rasterise layer",
    category: "Layers",
    ...onLayer(
      (layer) => ({ type: "rasteriseLayer", id: layer.id }),
      (layer) => layer.kind === "vector"
    ),
  },
  {
    id: "document.clear",
    label: "Clear canvas",
    category: "Document",
    ...dispatching({ type: "clearDocument" }),
  },
  {
    id: "view.zoomIn",
    label: "Zoom in",
    category: "View",
    keybinds: ["=", "+"],
    ...dispatching({ type: "zoomView", factor: ZOOM_STEP }),
  },
  {
    id: "view.zoomOut",
    label: "Zoom out",
    category: "View",
    keybinds: ["-", "_"],
    ...dispatching({ type: "zoomView", factor: 1 / ZOOM_STEP }),
  },
  // The brackets are size; rotation takes the pair beside them, which is
  // where Krita and Blender put a step through an angle too.
  {
    id: "view.rotateLeft",
    label: "Rotate left",
    category: "View",
    keybinds: [",", "<"],
    ...dispatching({ type: "rotateView", radians: -ROTATE_STEP }),
  },
  {
    id: "view.rotateRight",
    label: "Rotate right",
    category: "View",
    keybinds: [".", ">"],
    ...dispatching({ type: "rotateView", radians: ROTATE_STEP }),
  },
  {
    id: "view.flip",
    label: "Flip canvas horizontally",
    category: "View",
    keybinds: ["h"],
    ...dispatching({ type: "flipView" }),
  },
  {
    id: "view.toggleSnapping",
    label: "Toggle snapping",
    category: "View",
    keybinds: ["mod+;"],
    ...dispatching(({ engine }) => ({
      type: "setSnapping",
      enabled: !engine?.getSnapshot().snapping,
    })),
  },
  {
    id: "view.toggleRulers",
    label: "Toggle rulers",
    category: "View",
    keybinds: ["shift+r"],
    available: hasEngine,
    // A preference (08), remembered as well as shown, so a reload keeps it.
    run: ({ engine }) => {
      const visible = !engine?.getSnapshot().rulersVisible
      writeRulersVisible(visible)
      void engine?.dispatch({ type: "setRulersVisible", visible })
    },
  },
  {
    id: "view.toggleGuides",
    label: "Show or hide guides",
    category: "View",
    keybinds: ["mod+'"],
    ...dispatching(({ engine }) => ({
      type: "setGuidesVisible",
      visible: !engine?.getSnapshot().guidesVisible,
    })),
  },
  {
    id: "view.clearGuides",
    label: "Clear guides",
    category: "View",
    available: ({ engine }) => !!engine?.getSnapshot().guides.length,
    run: ({ engine }) => void engine?.dispatch({ type: "clearGuides" }),
  },
  {
    id: "view.toggleStraightEdge",
    label: "Place or remove the straight-edge",
    category: "View",
    keybinds: ["mod+shift+l"],
    ...dispatching(({ engine }) => {
      const snapshot = engine?.getSnapshot()
      // Laid down level across the middle of the canvas, where it can be
      // seen and picked up; the artist moves and turns it from there.
      return {
        type: "setStraightEdge",
        edge: snapshot?.straightEdge
          ? null
          : {
              x: (snapshot?.width ?? 0) / 2,
              y: (snapshot?.height ?? 0) / 2,
              angle: 0,
            },
      }
    }),
  },
  {
    id: "view.fit",
    label: "Fit canvas to window",
    category: "View",
    keybinds: ["0"],
    ...dispatching((context) => ({
      type: "fitView",
      occludedRight: context.occludedRight(),
    })),
  },
  {
    // Fit is the overview; with shift it is the way back to square. The
    // shifted key arrives as `)` on a US layout and as `0` on the layouts that
    // put a digit there unshifted, so both spellings mean the same key.
    id: "view.reset",
    label: "Reset view",
    category: "View",
    keybinds: ["shift+0", ")"],
    ...dispatching((context) => ({
      type: "resetView",
      occludedRight: context.occludedRight(),
    })),
  },
  // The arrows nudge the canvas, for the artist who has no wheel under the
  // hand that is free.
  {
    id: "view.panLeft",
    label: "Pan left",
    category: "View",
    keybinds: ["arrowleft"],
    ...dispatching({ type: "panView", dx: PAN_STEP, dy: 0 }),
  },
  {
    id: "view.panRight",
    label: "Pan right",
    category: "View",
    keybinds: ["arrowright"],
    ...dispatching({ type: "panView", dx: -PAN_STEP, dy: 0 }),
  },
  {
    id: "view.panUp",
    label: "Pan up",
    category: "View",
    keybinds: ["arrowup"],
    ...dispatching({ type: "panView", dx: 0, dy: PAN_STEP }),
  },
  {
    id: "view.panDown",
    label: "Pan down",
    category: "View",
    keybinds: ["arrowdown"],
    ...dispatching({ type: "panView", dx: 0, dy: -PAN_STEP }),
  },
])

/** Runs a studio command by id, as a button does, if it is available. */
export function runStudioCommand(id: string, context: StudioContext) {
  const command = studioCommands.get(id)
  if (!command || (command.available && !command.available(context))) return
  command.run(context)
}
