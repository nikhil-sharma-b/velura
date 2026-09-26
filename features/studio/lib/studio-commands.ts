import type { Engine, EngineCommand } from "@/engine"
import { createRegistry, type Command } from "@/features/commands/lib/registry"

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
   * A version being opened or taken back is itself an undo step in flight;
   * another on top would race it.
   */
  historyBusy: () => boolean
  /** How much of the right of the window fitting and resetting leaves clear. */
  occludedRight: () => number
  /** The eyedropper is held: the next click on the canvas samples. */
  setSampling: (sampling: boolean) => void
}

type StudioCommand = Command<StudioContext>

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
    id: "layer.group",
    label: "Group active layer",
    category: "Layers",
    ...dispatching({ type: "addGroup" }),
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
