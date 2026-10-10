"use client"

import { VectorBrushLibrary } from "./vector-brush-library"
import { createLocalVectorBrushStore } from "../lib/local-vector-brush-store"
import type { VectorBrushStore } from "../lib/vector-brush-store"

import {
  CaretDownIcon,
  ArrowClockwiseIcon,
  ArrowLeftIcon,
  ArrowsClockwiseIcon,
  ClockCounterClockwiseIcon,
  ArrowCounterClockwiseIcon,
  ArrowUUpLeftIcon,
  ArrowUUpRightIcon,
  ArrowsOutCardinalIcon,
  CopySimpleIcon,
  CornersOutIcon,
  CircleIcon,
  CursorIcon,
  HexagonIcon,
  LineSegmentIcon,
  PaintBrushIcon,
  PenNibIcon,
  CircleDashedIcon,
  DropHalfIcon,
  WaveSineIcon,
  ChartLineUpIcon,
  FlipHorizontalIcon,
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon,
  LassoIcon,
  MagicWandIcon,
  PolygonIcon,
  RectangleIcon,
  SelectionIcon,
  SlidersIcon,
  StackIcon,
} from "@phosphor-icons/react"
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"

import { Popover as PopoverPrimitive } from "radix-ui"
import { toast } from "sonner"
import { isViewPanButton } from "@/engine/input/view-gestures"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { PressureCurve } from "@/components/ui/pressure-curve"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import Link from "next/link"
import type { ComponentProps } from "react"
import type { Brush } from "@/engine/brush/brush"
import {
  canJoin,
  MAX_TAPER,
  type Taper,
  type CloudOptions,
  createEngine,
  type Engine,
  INITIAL_SNAPSHOT,
  isSelectionTool,
  isVectorTool,
  drawsOutlineOnly,
  toolShapeStyle,
  type VectorTool,
  type SelectionTool,
  type ShapeStyle,
  type Tool,
  MAX_ZOOM,
  MIN_ZOOM,
  type LayerSummary,
  type RemoteIndex,
  type SyncStatus,
} from "@/engine"

import { ColorPanel } from "@/features/color/components/color-panel"
import { createLocalPaletteStore } from "@/features/color/lib/local-palette-store"
import type { PaletteStore } from "@/features/color/lib/palette-store"

import { brushCommand, isBrushEdited } from "../lib/brush-draft"
import { createLocalBrushStore } from "../lib/local-brush-store"
import { createLocalPenSettingsStore } from "../lib/local-pen-settings"
import type { BrushStore } from "../lib/brush-store"
import { resolveLibraryBrush, setForNewBrush } from "../lib/brush-shelf"
import { DEFAULT_DOCUMENT_NAME } from "@/convex/lib/documents"
import { DEFAULT_LIBRARY_BRUSH_ID } from "@/engine/brush/presets"
import {
  dragCarriesFile,
  firstImageFile,
  placeImageFile,
} from "../lib/image-import"
import { KRITA_TEXTURES } from "../lib/shipped-textures"
import { readTipFiles } from "../lib/brush-import"
import {
  decodeImage,
  readFiles,
  readTextureFile,
  studioImport,
} from "../lib/texture-import"
import { BrushEditor } from "./brush-editor"
import {
  ImageTransform,
  LayerTransform,
  VectorTransform,
  PolygonHint,
  VectorSelection,
  VectorNodes,
} from "./image-transform"
import { RULER_SIZE, RulersAndGuides } from "./rulers-and-guides"
import { useRasterMagnification } from "../lib/magnification-preference"
import { useRulersVisible } from "../lib/ruler-preference"
import { EraserTrail } from "./eraser-trail"
import { StraightEdgeOverlay } from "./straight-edge"
import {
  SAMPLING_CURSOR,
  TOOL_CURSOR,
  VECTOR_CURSORS,
} from "../lib/tool-cursor"
import {
  BrushIcon,
  EraserToolIcon,
  ShapeEraserIcon,
  SmudgeToolIcon,
  VectorBrushToolIcon,
} from "./brush-icon"
import { BrushLibrary } from "./brush-library"
import { TiltToggle } from "./tilt-toggle"
import { IconButton } from "./icon-button"
import {
  lastInputWasPointer,
  returnFocusForKeysOnly,
} from "@/lib/input-modality"
import { SizeCursor } from "./size-cursor"
import { NumberField, SliderSetting } from "./slider-setting"
import { LayerPanel } from "./layer-panel"
import { ShapeStylePanel } from "./shape-style-panel"
import { VersionPanel, type VersionPreviewState } from "./version-panel"
import { ExportDialog } from "./export-dialog"
import {
  ConfirmLayerDialog,
  type LayerConfirmation,
} from "./confirm-layer-dialog"
import { FeatherDialog } from "./feather-dialog"
import { FilterDialog } from "./filter-dialog"
import {
  runStudioCommand,
  PALETTE_COMMAND,
  studioCommands,
  type StudioContext,
} from "../lib/studio-commands"
import { CommandPalette } from "@/features/commands/components/command-palette"
import { useKeybinds } from "@/features/commands/hooks/use-keybinds"
import { useBoundRegistry } from "@/features/commands/hooks/use-keybind-overrides"
import { PreferencesPanel } from "@/features/commands/components/preferences-panel"
import { KeybindHint } from "@/features/commands/components/keybind-hint"

function RailAction({
  side = "right",
  className,
  ...props
}: ComponentProps<typeof IconButton>) {
  return (
    <IconButton
      {...props}
      side={side}
      className={cn("rounded-lg", className)}
    />
  )
}

type FamilyMember = {
  tool: SelectionTool
  label: string
  /** How a sibling's tooltip names it, mid-sentence. */
  name: string
  icon: React.ReactNode
}

/**
 * The vector tools' rail buttons, in rail order and drawn as the vector apps
 * artists know draw them: first the two arrows that act on what is drawn — a
 * solid one picks objects and a hollow one their points, as in Illustrator —
 * then the freehand tools, the pen and the brush, then the shapes.
 */
const VECTOR_TOOL_RAIL = {
  objectSelect: {
    label: "Object selection tool",
    icon: <CursorIcon weight="fill" />,
  },
  node: { label: "Node tool", icon: <CursorIcon /> },
  pen: { label: "Pen tool", icon: <PenNibIcon /> },
  pressure: { label: "Vector brush tool", icon: <PaintBrushIcon /> },
  rectangle: { label: "Rectangle tool", icon: <RectangleIcon /> },
  ellipse: { label: "Ellipse tool", icon: <CircleIcon /> },
  polygon: { label: "Polygon tool", icon: <HexagonIcon /> },
  line: { label: "Line tool", icon: <LineSegmentIcon /> },
} satisfies Record<VectorTool, { label: string; icon: React.ReactNode }>
/** The shape tools, which share one rail slot so they cost one button. */
const SHAPE_TOOLS = ["rectangle", "ellipse", "polygon", "line"] as const
type ShapeTool = (typeof SHAPE_TOOLS)[number]
const VECTOR_RAIL_ORDER = (
  Object.keys(VECTOR_TOOL_RAIL) as VectorTool[]
).filter((tool) => !(SHAPE_TOOLS as readonly VectorTool[]).includes(tool))

/** The selection tools, by the rail slot each pair shares (09). */
const SELECTION_FAMILIES: readonly (readonly [FamilyMember, FamilyMember])[] = [
  [
    {
      tool: "rectSelect",
      label: "Rectangle selection tool",
      name: "rectangle selection",
      icon: <SelectionIcon />,
    },
    {
      tool: "ellipseSelect",
      label: "Ellipse selection tool",
      name: "ellipse selection",
      icon: <CircleDashedIcon />,
    },
  ],
  [
    {
      tool: "lasso",
      label: "Lasso selection tool",
      name: "lasso selection",
      icon: <LassoIcon />,
    },
    {
      tool: "polygonLasso",
      label: "Polygonal lasso selection tool",
      name: "polygonal lasso selection",
      icon: <PolygonIcon />,
    },
  ],
  [
    {
      tool: "magicWand",
      label: "Magic wand tool",
      name: "magic wand",
      icon: <MagicWandIcon />,
    },
    {
      tool: "moveSelection",
      label: "Move selection outline tool",
      name: "move selection outline",
      icon: <ArrowsOutCardinalIcon />,
    },
  ],
]

/**
 * Two sibling tools in one rail slot, as the rail has height for no more:
 * the one last in the hand shows, a press picks it up, and a second press
 * swaps to its sibling. The slot follows the tool in the hand rather than
 * its own presses, so a keybind moves it as a press does. A pair of dots
 * and the tooltip tell the slot holds two.
 */
function ToolFamilySlot({
  members,
  tool,
  onPick,
}: {
  members: readonly [FamilyMember, FamilyMember]
  tool: Tool
  onPick(tool: SelectionTool): void
}) {
  const [shown, setShown] = useState(members[0])
  const held = members.find((member) => member.tool === tool)
  if (held && held !== shown) setShown(held)
  const sibling = members[0] === shown ? members[1] : members[0]
  return (
    <RailAction
      label={shown.label}
      command={`tool.${shown.tool}`}
      variant={held ? "default" : "ghost"}
      size="icon"
      aria-pressed={!!held}
      detail={`${WORKS_ON.selection}. Press again for ${sibling.name}`}
      onClick={() => onPick(held ? sibling.tool : shown.tool)}
      className="relative"
    >
      {shown.icon}
      <FamilyDots count={members.length} shown={members.indexOf(shown)} />
    </RailAction>
  )
}

/**
 * A dot per sibling in a rail slot, the one in the slot filled: unlike the
 * brush button's corner notch, which opens a menu, this says a press swaps.
 * Its button is `relative`.
 */
function FamilyDots({ count, shown }: { count: number; shown: number }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute bottom-0.5 left-1/2 flex -translate-x-1/2 gap-0.5"
    >
      {Array.from({ length: count }, (_, index) => (
        <span
          key={index}
          className={cn(
            "size-0.75 rounded-full bg-current",
            index === shown ? "opacity-80" : "opacity-30"
          )}
        />
      ))}
    </span>
  )
}

/**
 * The shape tools in one rail slot, as the rail has height for no more. The
 * slot shows the shape last in the hand: a press picks it up, and a press
 * while it is held opens the menu of every shape. Like the selection pairs,
 * the slot follows the tool in the hand, so a keybind moves it too.
 */
function ShapeToolSlot({
  tool,
  onPick,
}: {
  tool: Tool
  onPick(tool: ShapeTool): void
}) {
  const [shown, setShown] = useState<ShapeTool>(SHAPE_TOOLS[0])
  const [open, setOpen] = useState(false)
  const commands = useBoundRegistry(studioCommands)
  const held = SHAPE_TOOLS.find((shape) => shape === tool)
  if (held && held !== shown) setShown(held)
  return (
    // Every popover over the canvas is modal: the click that closes it reaches
    // nothing else, so dismissing a panel never leaves a mark on the canvas.
    <PopoverPrimitive.Root modal open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Anchor asChild>
        <RailAction
          label={VECTOR_TOOL_RAIL[shown].label}
          command={`tool.${shown}`}
          variant={held ? "default" : "ghost"}
          size="icon"
          aria-pressed={!!held}
          aria-haspopup="menu"
          aria-expanded={open}
          detail={`${WORKS_ON.vector}. Press again for the other shapes`}
          onClick={() => (held ? setOpen((was) => !was) : onPick(shown))}
          onContextMenu={(event) => {
            event.preventDefault()
            setOpen(true)
          }}
          className="relative"
        >
          {VECTOR_TOOL_RAIL[shown].icon}
          <MenuNotch />
        </RailAction>
      </PopoverPrimitive.Anchor>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          onCloseAutoFocus={returnFocusForKeysOnly}
          side="right"
          align="start"
          sideOffset={10}
          collisionPadding={12}
          role="menu"
          aria-label="Shape tools"
          className="z-50 flex flex-col gap-0.5 rounded-xl border bg-background p-1 shadow-xl outline-none"
        >
          {SHAPE_TOOLS.map((shape) => (
            <button
              key={shape}
              type="button"
              role="menuitemradio"
              aria-checked={shape === tool}
              onClick={() => {
                setOpen(false)
                onPick(shape)
              }}
              className={cn(
                "flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent [&_svg]:size-4",
                shape === tool && "bg-accent text-accent-foreground"
              )}
            >
              {VECTOR_TOOL_RAIL[shape].icon}
              <span className="flex-1">
                {VECTOR_TOOL_RAIL[shape].label.replace(/ tool$/, "")}
              </span>
              <KeybindHint registry={commands} id={`tool.${shape}`} />
            </button>
          ))}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}

/**
 * The corner mark of a button that opens a panel beside it, as against the
 * dots on a slot whose second press swaps the tool. It takes the top corner,
 * clear of a setting's value underneath. Its button is `relative`.
 */
function MenuNotch() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute top-1 right-1 size-1 bg-current opacity-60 [clip-path:polygon(0_0,100%_0,100%_100%)]"
    />
  )
}

/**
 * What a new shape is given, drawn: a square filled, outlined, or both, so
 * the trigger says which at a glance where a width alone could not.
 */
function ShapePaintIcon({ style }: { style: ShapeStyle }) {
  // With neither paint on, a faint dashed square, so the trigger is never
  // blank.
  const bare = !style.fill && !style.stroke
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="size-4">
      <rect
        x="2"
        y="2"
        width="12"
        height="12"
        rx="1.5"
        fill={style.fill ? "currentColor" : "none"}
        fillOpacity={style.stroke ? 0.35 : 0.85}
        stroke={style.stroke || bare ? "currentColor" : "none"}
        strokeOpacity={bare ? 0.5 : 1}
        strokeWidth="1.5"
        strokeDasharray={bare ? "2 2" : undefined}
      />
    </svg>
  )
}

/**
 * One kind of tool in the rail: the paint tools, the selection tools, or the
 * vector tools. A kind that cannot act on the layer in hand is dimmed, not
 * hidden, so the rail keeps its shape and the tools stay where the hand knows
 * them; pointing at one brings it back up to be read.
 */
function ToolGroup({
  label,
  dimmed = false,
  children,
}: {
  label: string
  dimmed?: boolean
  children: React.ReactNode
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn("flex flex-col items-center gap-1", dimmed && DIMMED_TOOL)}
    >
      {children}
    </div>
  )
}

/** A tool that cannot act on the layer in hand, brought up when pointed at. */
const DIMMED_TOOL =
  "opacity-40 motion-safe:transition-opacity focus-within:opacity-100 hover:opacity-100"

/** The rule between two kinds of tool. */
const RailDivider = () => (
  <span aria-hidden className="my-0.5 h-px w-5 shrink-0 bg-studio-edge" />
)

/** Which layers each kind of tool works on, as its tooltip says. */
const WORKS_ON = {
  paint: "Works on paint layers",
  eraser: "Works on paint and vector layers",
  selection: "Works on any layer",
  vector: "Works on vector layers",
} as const

const percent = (share: number) => Math.round(share * 100)

/** "Start 30%, end 50%", or "None" for a stroke left whole. */
function taperSummary(taper: Taper) {
  if (!taper.start && !taper.end) return "None"
  return `Start ${percent(taper.start)}%, end ${percent(taper.end)}%`
}

/** Start and end under the icon, as "30·50"; a lone 0 for no taper. */
function taperReadout(taper: Taper) {
  if (!taper.start && !taper.end) return "0"
  return `${percent(taper.start)}·${percent(taper.end)}`
}

/** A stroke swelling from a point at one tip to a point at the other. */
function TaperIcon() {
  return (
    <svg viewBox="0 0 256 256" className="size-4" aria-hidden="true">
      <path
        d="M24 168 C 80 120, 176 104, 232 88 C 180 124, 96 152, 24 168 Z"
        fill="currentColor"
      />
    </svg>
  )
}

/** Compact triggers keep adjustments close without covering the artwork. */
function QuickSetting({
  label,
  value,
  readout,
  icon,
  children,
}: {
  label: string
  value: string
  readout: string
  icon: React.ReactNode
  children: React.ReactNode
}) {
  // The value sits under the icon rather than beside it, so the panel keeps
  // the tool bar's width: a readout is what tells a setting from a tool.
  return (
    <PopoverPrimitive.Root modal>
      <PopoverPrimitive.Trigger asChild>
        <IconButton
          label={`${label}: ${value}`}
          side="right"
          variant="ghost"
          className="relative h-auto w-8 flex-col gap-0.5 rounded-lg px-0 py-1"
        >
          {icon}
          <span className="text-[10px] leading-none font-medium text-foreground/75 tabular-nums">
            {readout}
          </span>
          <MenuNotch />
        </IconButton>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          onCloseAutoFocus={returnFocusForKeysOnly}
          side="right"
          align="start"
          sideOffset={10}
          collisionPadding={12}
          aria-label={`${label} adjustment`}
          className="z-50 w-56 rounded-xl border bg-background p-3 shadow-xl outline-none"
        >
          {children}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}

/** What a shape is given, in words, for the shape options' trigger. */
function shapeSummary(style: ShapeStyle): string {
  return (
    [style.fill && "filled", style.stroke && `${style.strokeWidth}px outline`]
      .filter(Boolean)
      .join(", ") || "no paint"
  )
}

const shapeReadout = (style: ShapeStyle) =>
  style.stroke ? `${style.strokeWidth}` : "fill"

const getInitialSnapshot = () => INITIAL_SNAPSHOT
const subscribeToNothing = () => () => {}

/** What the sync-status pill says, from genuine upload state — never a guess. */
function syncStatusLabel(status: SyncStatus | null): string {
  switch (status) {
    case "syncing":
      return "Syncing…"
    case "fully-synced":
      return "Synced"
    case "saved-locally":
      return "Saved on this device"
    default:
      return ""
  }
}

function findLayer(
  nodes: readonly LayerSummary[],
  id: string
): LayerSummary | undefined {
  for (const node of nodes) {
    if (node.id === id) return node
    if (node.kind === "group") {
      const found = findLayer(node.children, id)
      if (found) return found
    }
  }
}

/**
 * `documentId` names where the work is kept. Every document is stored locally
 * under its id — the cloud copy is made from that, never instead of it — so a
 * host that omits one gets a session whose pixels do not outlive the tab.
 */
export function CanvasHost({
  documentId,
  documentName,
  libraryHref,
  documentSize,
  remote,
  onPreview,
  onSyncStatus,
  palettes,
  brushes,
  vectorBrushes,
  openElsewhere = false,
}: {
  documentId?: string
  /** The title shown above the canvas; a document with none is called `DEFAULT_DOCUMENT_NAME`. */
  documentName?: string
  /** Where "Back to documents" goes; a host with no library passes none. */
  libraryHref?: string
  /** Fixed authored size supplied by the document created in the library. */
  documentSize?: { width: number; height: number }
  /**
   * Where palettes are kept. The cloud host passes an account-backed store so
   * they follow the artist between machines; a host that passes none — the
   * anonymous studio, which mounts outside the Convex provider — gets one
   * backed by this browser.
   */
  palettes?: PaletteStore
  /**
   * Where brushes are kept (25). As with palettes, the cloud host passes an
   * account-backed store so they follow the artist between machines and the
   * anonymous one gets this browser.
   */
  brushes?: BrushStore
  vectorBrushes?: VectorBrushStore
  /** The cloud-sync backend, when this document has an owned Convex row to sync to. */
  remote?: RemoteIndex
  /** Each preview the engine encodes for the library, before it is uploaded. */
  onPreview?: CloudOptions["onPreview"]
  /** The sync status, including a last flush that outlives this canvas. */
  onSyncStatus?: CloudOptions["onSyncStatus"]
  /** Whether another tab or device currently has this same document open. */
  openElsewhere?: boolean
}) {
  const [engine, setEngine] = useState<Engine | null>(null)
  const [panelsOpen, setPanelsOpen] = useState(true)
  const [historyOpen, setHistoryOpen] = useState(false)
  /**
   * What the version panel has on the canvas. Kept here rather than in the
   * panel because closing the history is leaving the past — a version still
   * on trial goes back with it — and the host is present for every way the
   * panel goes: its own close, the toolbar button, and leaving the canvas,
   * where the revert has to land before the engine is disposed or the
   * trial would be what the last sync sends.
   */
  const versionPreview = useRef<VersionPreviewState>({
    busy: false,
    onTrial: false,
  })
  const [historyBusy, setHistoryBusy] = useState(false)
  // The ref is what the teardown and the keyboard read, the state is what
  // renders; they only ever change together.
  function setVersionPreview(state: VersionPreviewState) {
    versionPreview.current = state
    setHistoryBusy(state.busy)
  }
  /** The revert under way, so a second request joins it instead of undoing again. */
  const revertInFlight = useRef<Promise<void> | null>(null)
  /**
   * Takes a version on trial back — the one place that does, for closing the
   * history and for leaving the canvas alike. Everything that could race it
   * (the panel, undo, leaving) reads `busy` and holds off until it lands.
   */
  function takeTrialBack(target: Engine): Promise<void> {
    if (revertInFlight.current) return revertInFlight.current
    if (!versionPreview.current.onTrial || !target.canRevertRestore())
      return Promise.resolve()
    setVersionPreview({ busy: true, onTrial: true })
    revertInFlight.current = target
      .revertRestore()
      .then(
        () => undefined,
        () => {
          // Only a canvas already torn down fails here, and it took the
          // trial with it.
        }
      )
      .finally(() => {
        revertInFlight.current = null
        setVersionPreview({ busy: false, onTrial: false })
      })
    return revertInFlight.current
  }
  /** Closes the history; closing it is leaving the past (see `versionPreview`). */
  async function closeHistory() {
    // Not while a version is being opened or taken back: the first would land
    // after the panel had gone with nothing left to take it back, and the
    // second is already closing.
    if (versionPreview.current.busy) return
    if (engine) await takeTrialBack(engine)
    setHistoryOpen(false)
  }
  const [colorOpen, setColorOpen] = useState(false)
  const [brushOpen, setBrushOpen] = useState(false)
  const brushButton = useRef<HTMLButtonElement>(null)
  /** The docked editor's panel, whose strip fitting the view has to avoid. */
  const brushPanel = useRef<HTMLElement>(null)
  /** Whichever of collapse and expand is showing; focus follows the swap. */
  const layersToggle = useRef<HTMLButtonElement>(null)
  const layersToggled = useRef(false)
  const [eraserOpen, setEraserOpen] = useState(false)
  const [vectorBrushOpen, setVectorBrushOpen] = useState(false)
  const [featherRadius, setFeatherRadius] = useState(10)
  const [featherOpen, setFeatherOpen] = useState(false)
  const [confirming, setConfirming] = useState<LayerConfirmation | null>(null)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [pressureOpen, setPressureOpen] = useState(false)
  /**
   * The brush as it was last saved. The engine holds the *working* brush — so
   * an edit paints immediately, which is the whole point of a live editor —
   * and this is what it is measured against, so nothing the artist tries is
   * kept until they say so. The brush library (D25) is what will make this
   * outlive the session.
   */
  const [savedBrush, setSavedBrush] = useState<Brush | null>(null)
  /** Why the last attempt to keep a brush failed, if it did. */
  const [brushProblem, setBrushProblem] = useState<string | null>(null)
  /** Why the last dropped or pasted image did not come in, if it did not. */
  const [imageProblem, setImageProblem] = useState<string | null>(null)
  /** An image is over the canvas and would land if let go of. */
  const [imageOverCanvas, setImageOverCanvas] = useState(false)
  /** Alt is down, so the next click on the canvas samples rather than paints. */
  const [sampling, setSampling] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [preferencesOpen, setPreferencesOpen] = useState(false)
  // Zen hides the controls rather than unmounting them, so the panels the
  // artist had open are open again when they come back.
  const [zen, setZen] = useState(false)
  const [rulerLayer, setRulerLayer] = useState<HTMLDivElement | null>(null)
  const rulersVisible = useRulersVisible()
  const rasterMagnification = useRasterMagnification()
  /** The canvas the engine presents into; the transform box sits over it. */
  const [canvasElement, setCanvasElement] = useState<HTMLCanvasElement | null>(
    null
  )
  const documentWidth = documentSize?.width
  const documentHeight = documentSize?.height
  // Created once per host: the store owns the subscription the picker reads
  // through, so a new one each render would resubscribe on every keystroke.
  const localPalettes = useMemo(() => createLocalPaletteStore(), [])
  const paletteStore = palettes ?? localPalettes
  // Held in a ref so that swapping the store — which happens when anonymous
  // work is carried into an account — does not tear the engine down and take
  // the document with it.
  const paletteRef = useRef(paletteStore)
  paletteRef.current = paletteStore
  // Read through a ref, like the palette, so a host passing a fresh callback
  // each render does not tear the engine down and rebuild it.
  const previewRef = useRef(onPreview)
  previewRef.current = onPreview
  const syncStatusRef = useRef(onSyncStatus)
  syncStatusRef.current = onSyncStatus
  const localBrushes = useMemo(() => createLocalBrushStore(), [])
  const brushStore = brushes ?? localBrushes
  const localVectorBrushes = useMemo(() => createLocalVectorBrushStore(), [])
  const vectorBrushStore = vectorBrushes ?? localVectorBrushes
  const vectorBrushLibrary = vectorBrushStore.useVectorBrushLibrary()
  const penStore = useMemo(() => createLocalPenSettingsStore(), [])
  const pen = penStore.usePenSettings()
  const library = brushStore.useBrushLibrary(documentId)
  const textureNames = useMemo(
    () =>
      new Map(library.textures.map((texture) => [texture.id, texture.name])),
    [library.textures]
  )
  const snapshot = useSyncExternalStore(
    engine?.subscribe ?? subscribeToNothing,
    engine?.getSnapshot ?? getInitialSnapshot,
    getInitialSnapshot
  )
  // A selection that goes while the dialog is up (an undo by key) takes the
  // question with it, rather than leaving it to reappear with the next one.
  const [featherFor, setFeatherFor] = useState(snapshot.selection)
  if (featherFor !== snapshot.selection) {
    setFeatherFor(snapshot.selection)
    if (!snapshot.selection && featherOpen) setFeatherOpen(false)
  }

  // The rulers follow the preference (08): this device's copy as soon as
  // the engine is ready, so a reload keeps them, and the account's when it
  // arrives or another tab changes it.
  useEffect(() => {
    if (snapshot.status !== "ready" || !engine) return
    if (engine.getSnapshot().rulersVisible === rulersVisible) return
    void engine.dispatch({ type: "setRulersVisible", visible: rulersVisible })
  }, [engine, snapshot.status, rulersVisible])

  // How raster layers look magnified follows this device's preference
  // (sharp-zoom 03), from the first ready frame and as it changes.
  useEffect(() => {
    if (snapshot.status !== "ready" || !engine) return
    if (engine.getSnapshot().rasterMagnification === rasterMagnification) return
    void engine.dispatch({
      type: "setRasterMagnification",
      mode: rasterMagnification,
    })
  }, [engine, snapshot.status, rasterMagnification])

  // React 19 ref cleanup also covers Strict Mode's attach/detach rehearsal.
  const attach = useCallback(
    (canvas: HTMLCanvasElement | null) => {
      if (!canvas) return
      // Kept so the transform box can be laid out over exactly the pixels the
      // engine is presenting into.
      setCanvasElement(canvas)
      const attached = createEngine(canvas, {
        resolveTexture: (id) => KRITA_TEXTURES.load(id),
        ...(documentWidth !== undefined && documentHeight !== undefined
          ? { documentSize: { width: documentWidth, height: documentHeight } }
          : {}),
        ...(documentId ? { persistence: { documentId } } : {}),
        ...(remote
          ? {
              cloud: {
                remote,
                onPreview: (preview) => previewRef.current?.(preview),
                onSyncStatus: (status) => syncStatusRef.current?.(status),
              },
            }
          : {}),
        // What "recent" means: a colour that reached the canvas. A recents
        // list fed by the picker instead records colours dialled past and
        // never used, and misses every colour actually painted with.
        onStrokeCommitted: (hex) => {
          void paletteRef.current.recordUsed(hex).catch(() => {
            // A recent colour is a convenience, not work. Losing one is not
            // worth interrupting a stroke to report.
          })
        },
      })
      setEngine(attached)
      const resize = () => {
        const bounds = canvas.getBoundingClientRect()
        void attached.dispatch({
          type: "resize",
          width: bounds.width,
          height: bounds.height,
          devicePixelRatio: window.devicePixelRatio || 1,
        })
      }
      const observer = new ResizeObserver(resize)
      observer.observe(canvas)
      let density = window.devicePixelRatio
      let frame: number
      // Density can change without layout or media-query events (e.g. emulation).
      // Only a change issues a command; steady frames never touch React state.
      const watchDensity = () => {
        if (density !== window.devicePixelRatio) {
          density = window.devicePixelRatio
          resize()
        }
        frame = requestAnimationFrame(watchDensity)
      }
      resize()
      frame = requestAnimationFrame(watchDensity)
      void attached.dispatch({ type: "initialize" })
      return () => {
        observer.disconnect()
        cancelAnimationFrame(frame)
        // A trial left on the canvas goes back before the engine goes, or the
        // last sync would send it as the document; a revert already under
        // way is joined rather than repeated.
        const pending =
          revertInFlight.current ??
          (versionPreview.current.onTrial && attached.canRevertRestore()
            ? takeTrialBack(attached)
            : null)
        if (pending) void pending.finally(() => attached.dispose())
        else attached.dispose()
      }
    },
    [documentHeight, documentId, documentWidth, remote]
  )

  // Completed strokes are already on disk; this is for the save that a commit
  // queued and the tab is about to outrun. `pagehide` covers the close and the
  // navigation, `visibilitychange` the switch away that never comes back.
  //
  // The cloud flush this also triggers is a multi-round-trip upload, which a
  // browser tearing down the page can outrun before it settles — there is no
  // `sendBeacon`-shaped way to do a presigned multi-tile PUT plus a signed
  // mutation call. That is not data loss: local storage already has the
  // stroke, the flush is replication, and the next session's own flush (idle,
  // its own tab-hide, or a future open) picks up whatever this one missed.
  // The stored calibration is put back the moment there is an engine to take
  // it, rather than being read into the panel and waiting for the artist to
  // touch a control: a pressure curve that has to be re-set to take effect is
  // one that was not really saved.
  useEffect(() => {
    if (!engine) return
    void engine.dispatch({
      type: "setPressureCurve",
      curve: pen.pressureCurve,
    })
    void engine.dispatch({ type: "setTiltEnabled", enabled: pen.tiltEnabled })
    // Deliberately keyed on the engine alone. This restores what was stored;
    // the controls below write to the store and dispatch themselves, and
    // re-running here on every change would fight the artist's own edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine])

  useEffect(() => {
    if (!engine) return
    const flush = () => {
      void engine.save()
    }
    window.addEventListener("pagehide", flush)
    document.addEventListener("visibilitychange", flush)
    return () => {
      window.removeEventListener("pagehide", flush)
      document.removeEventListener("visibilitychange", flush)
    }
  }, [engine])

  // Undo and navigation are keystrokes before they are buttons, and the canvas
  // has no focus of its own to hang them off: the artist's hand is on the pen,
  // not on the page.
  /**
   * An image from anywhere outside the app — dropped off the desktop, pasted
   * off the clipboard — onto a layer of its own. Three routes reach this (the
   * panel's own button is the third) and they differ only in where the file
   * came from, so the placement itself lives in one place.
   */
  const placeImage = useCallback(
    (file: File) => {
      if (!engine) return
      setImageProblem(null)
      void placeImageFile(engine, file).catch((error: unknown) =>
        setImageProblem(
          error instanceof Error
            ? error.message
            : "That image could not be placed."
        )
      )
    },
    [engine]
  )

  // Pasting is bound on the window rather than on the canvas: the canvas
  // cannot hold focus while the pen is drawing on it, and an artist who has
  // just copied a screenshot expects Cmd-V to work wherever they last clicked.
  useEffect(() => {
    if (!engine) return
    const onPaste = (event: ClipboardEvent) => {
      // A field being typed in owns its own paste, and this is not it.
      const target = event.target as HTMLElement | null
      if (
        target?.isContentEditable ||
        ["INPUT", "TEXTAREA"].includes(target?.tagName ?? "")
      )
        return
      const file = firstImageFile(event.clipboardData)
      if (!file) return
      event.preventDefault()
      placeImage(file)
    }
    window.addEventListener("paste", onPaste)
    return () => window.removeEventListener("paste", onPaste)
  }, [engine, placeImage])

  /**
   * How much of the right of the window fitting and resetting should leave
   * clear. Only the docked brush editor counts: the artist is testing strokes
   * beside it, so the piece must not sit under it. The other floating controls
   * are small enough that the artwork keeps the full window beneath them.
   */
  const occludedRight = useCallback(() => {
    const panel = brushPanel.current
    // A hidden panel measures as a zero rect at the left edge, which would
    // read as covering the whole window.
    if (!panel || !panel.getClientRects().length) return 0
    return Math.max(0, window.innerWidth - panel.getBoundingClientRect().left)
  }, [])

  /**
   * Collapse and expand are two buttons that replace each other, so the one
   * pressed unmounts under the keyboard. Focus moves to its replacement — only
   * after a press, never on the first render.
   */
  useEffect(() => {
    if (!layersToggled.current) return
    layersToggled.current = false
    layersToggle.current?.focus()
  }, [panelsOpen])

  // Undo, navigation and size are keystrokes before they are buttons, and
  // every one of them — keys, buttons and tooltips — goes through the studio's
  // command registry, so they agree about what a key does.
  const commandContext: StudioContext = {
    engine,
    historyBusy: () => versionPreview.current.busy,
    occludedRight,
    setSampling,
    togglePalette: () => setPaletteOpen((open) => !open),
    openPreferences: () => setPreferencesOpen(true),
    toggleZen: () => setZen((on) => !on),
    openFeather: () => setFeatherOpen(true),
    confirmClear: (layer) => setConfirming({ layer, action: "clear" }),
    confirmDelete: (layer) => setConfirming({ layer, action: "delete" }),
  }
  // The shape options are memoised, so they get one handle on the commands
  // for good, reading whichever context is current when one runs.
  const latestContext = useRef(commandContext)
  useEffect(() => {
    latestContext.current = commandContext
  })
  const runShapeCommand = useCallback(
    (id: string) => runStudioCommand(id, latestContext.current),
    []
  )
  /** The selection's style while there is one, else what the tool in the
   * hand gives: a line or a brush stroke is outlined whatever the style says. */
  const toolStyle = useMemo(
    () => toolShapeStyle(snapshot.tool, snapshot.shapeStyle),
    [snapshot.tool, snapshot.shapeStyle]
  )
  const shapeOptions = snapshot.selectionStyle ?? toolStyle
  // With a vector tool in the hand, the size setting is the outline width.
  const vectorWidth = isVectorTool(snapshot.tool)
  // The layer in hand decides which kinds of tool can act on it, as the
  // engine does: a locked layer or a group takes no tool but a selection;
  // shapes go only onto a vector layer; paint never does, and a placed photo
  // takes neither brush nor eraser until it is painted on, save into either's
  // mask.
  const handLayer = findLayer(snapshot.layers, snapshot.activeLayerId)
  const untouchable =
    !handLayer || handLayer.kind === "group" || !!handLayer.locked
  const onVectorLayer = handLayer?.kind === "vector"
  const intoMask = snapshot.paintingMask && !!handLayer?.mask
  const onPlacedPhoto =
    handLayer?.kind === "raster" && handLayer.image && !intoMask
  const brushDimmed =
    untouchable || (onVectorLayer && !intoMask) || onPlacedPhoto
  const eraserDimmed = untouchable || onPlacedPhoto
  // Smudge smears a paint layer's own pixels, or any layer's mask: where
  // the brush can paint.
  const smudgeDimmed = brushDimmed
  // On a vector layer the eraser is two, as the selection pairs are: one
  // takes the pixels under its tip, the other whole shapes.
  const vectorErasing = onVectorLayer && !intoMask
  const shapeEraser = vectorErasing && snapshot.vectorEraser === "object"
  const vectorDimmed = untouchable || !onVectorLayer
  // The artist's own keybinds over the defaults. While preferences are open
  // the keys are being rebound, not used.
  const commands = useBoundRegistry(studioCommands)
  useKeybinds(commands, commandContext, !preferencesOpen)

  /**
   * Frames the document the first time it is ready to be looked at.
   *
   * The engine opens on the identity view, which is the honest default for
   * geometry but shows an 8192px piece at 8192px. Fitting is the host's call
   * so the artwork uses the full viewport beneath floating controls. It waits for
   * `ready`, by which point the resize dispatched on attach has told the
   * engine how big the window is.
   */
  const framed = useRef<string | undefined>(undefined)
  const documentKey = documentId ?? "session"
  useEffect(() => {
    if (!engine || snapshot.status !== "ready") return
    if (framed.current === documentKey) return
    framed.current = documentKey
    void engine.dispatch({
      type: "fitView",
      occludedRight: 0,
    })
    // Only on the way in: re-fitting when the artist opens a panel would throw
    // away the zoom they had chosen to work at.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, snapshot.status, documentKey])

  // A brush names its textures and never carries them (24), so a library
  // synced from another machine arrives as definitions pointing at assets this
  // engine has never seen. Registering them is what makes those brushes
  // paintable here rather than refused as naming nothing.
  useEffect(() => {
    if (!engine) return
    for (const texture of library.textures)
      void engine
        .dispatch({
          type: "registerTexture",
          id: texture.id,
          texture: texture.texture,
        })
        .catch(() => {
          // One unreadable asset must not stop the rest of the library
          // loading; a brush naming it will say so when it is picked up.
        })
  }, [engine, library.textures])

  /**
   * The brush this session starts with (25): the one this document was last
   * painted with, or a ready-made one if it has never been painted in.
   *
   * The engine's own default is the plain round brush of ticket 04 — no tip,
   * no paper, no dynamics — which is a starting point for the renderer and not
   * a brush anyone would choose. Putting a shipped brush in the hand here is
   * what "opens to a set of ready-made brushes and can work immediately"
   * actually means at the moment the canvas appears.
   *
   * Once per document. After this, what is in the hand is whatever the artist
   * has since picked up, and re-applying a remembered brush because a query
   * re-resolved would take the pen out of their hand mid-session.
   */
  const restoredFor = useRef<string | null>(null)
  useEffect(() => {
    if (!engine || !documentId || !library.loaded) return
    if (restoredFor.current === documentId) return
    restoredFor.current = documentId
    const last = library.lastUsed
    // The smudge's own size and strength come back whatever brush does.
    if (last?.smudge)
      void engine
        .dispatch({ type: "setSmudge", ...last.smudge })
        .catch(() => {})
    // A remembered brush that has since been deleted falls back to the
    // ready-made one rather than leaving the session on the engine's default.
    const entry =
      (last ? resolveLibraryBrush(last.brushId, library.brushes) : undefined) ??
      resolveLibraryBrush(DEFAULT_LIBRARY_BRUSH_ID, library.brushes)
    if (!entry) return
    const restored =
      // The size is restored beside the brush, since size is adjusted
      // constantly and almost never saved into one — the brush without it is
      // still the wrong tool.
      last && entry.id === last.brushId
        ? {
            ...entry.brush,
            shape: { ...entry.brush.shape, radius: last.radius },
          }
        : entry.brush
    void engine.dispatch(brushCommand(restored)).then(
      () => setSavedBrush(restored),
      () => {}
    )
  }, [engine, documentId, library])

  /**
   * Remembers what is in the hand, so the next session can put it back.
   *
   * Settled rather than continuous: size is a dragged slider, and a write per
   * frame of that drag would be a mutation per frame. Waiting for the hand to
   * stop costs nothing an artist can perceive — the value written is the one
   * they left it at either way.
   */
  const currentBrushId = snapshot.brush.id
  const currentRadius = snapshot.brush.shape.radius
  const smudgeRadius = snapshot.smudge.radius
  const smudgeStrength = snapshot.smudge.strength
  useEffect(() => {
    // Never before the restore has run: writing on the way in would record
    // the default brush over the one this document was actually left with.
    if (!documentId || !library.loaded || restoredFor.current !== documentId)
      return
    const timer = setTimeout(() => {
      void brushStore
        .recordLastUsed(documentId, currentBrushId, currentRadius, {
          radius: smudgeRadius,
          strength: smudgeStrength,
        })
        .catch(() => {
          // Which brush was in the hand is a convenience, not the painting.
        })
    }, 1_000)
    return () => clearTimeout(timer)
  }, [
    brushStore,
    documentId,
    library.loaded,
    currentBrushId,
    currentRadius,
    smudgeRadius,
    smudgeStrength,
  ])

  // The engine starts from the same brush the initial snapshot describes, so
  // the baseline needs no effect to establish: an unsaved session is measured
  // against the default brush, exactly as the engine's own is.
  const saved = savedBrush ?? INITIAL_SNAPSHOT.brush
  const activeTip =
    snapshot.tool === "eraser" ? snapshot.eraser : snapshot.brush
  // Smudge keeps a size of its own, apart from the brush whose tip it wears.
  const smudging = snapshot.tool === "smudge"
  const tipRadius = smudging ? snapshot.smudge.radius : activeTip.shape.radius
  /** Half the size setting, as a tip's radius or half an outline's width. */
  const sizeRadius = vectorWidth ? shapeOptions.strokeWidth / 2 : tipRadius
  /** Sets the size of whichever paint tool is in the hand. */
  const setTipRadius = (radius: number) =>
    void engine?.dispatch({
      type: smudging
        ? "setSmudge"
        : snapshot.tool === "eraser"
          ? "setEraser"
          : "setBrush",
      radius,
    })
  const brushEdited = isBrushEdited(saved, snapshot.brush)

  const unavailable = snapshot.status === "unavailable"
  const failed = snapshot.status === "failed"
  const viewActions = [
    ["view.zoomOut", <MagnifyingGlassMinusIcon key="zoom-out" />],
    ["view.zoomIn", <MagnifyingGlassPlusIcon key="zoom-in" />],
    ["view.rotateLeft", <ArrowCounterClockwiseIcon key="rotate-left" />],
    ["view.rotateRight", <ArrowClockwiseIcon key="rotate-right" />],
    ["view.flip", <FlipHorizontalIcon key="flip" />],
    ["view.fit", <CornersOutIcon key="fit" />],
    ["view.reset", <ArrowsClockwiseIcon key="reset" />],
  ] as const
  return (
    <main
      className="fixed inset-0 overflow-hidden bg-canvas-matting"
      data-engine-status={snapshot.status}
      onDragOver={(event) => {
        // A drag's contents cannot be read until it is dropped, so a file of
        // any kind is welcomed here and the drop says whether it was an image.
        // Text and links are left alone: the browser's own answer to those is
        // better than a canvas swallowing them.
        if (!dragCarriesFile(event.dataTransfer)) return
        event.preventDefault()
        event.dataTransfer.dropEffect = "copy"
        setImageOverCanvas(true)
      }}
      onDragLeave={(event) => {
        // Crossing between the panels and the canvas is not leaving: only a
        // pointer that has left the window entirely puts the hint away.
        if (event.currentTarget.contains(event.relatedTarget as Node | null))
          return
        setImageOverCanvas(false)
      }}
      onDrop={(event) => {
        if (!dragCarriesFile(event.dataTransfer)) return
        event.preventDefault()
        setImageOverCanvas(false)
        const file = firstImageFile(event.dataTransfer)
        // Told, rather than nothing happening: a dropped file that vanished
        // without a word is indistinguishable from a bug.
        if (!file) setImageProblem("That file is not an image.")
        else placeImage(file)
      }}
    >
      <canvas
        ref={attach}
        role="img"
        aria-label="Drawing canvas"
        onPointerDown={(event) => {
          // Only input that would have painted is worth a refusal: the
          // navigation buttons and the eyedropper were never a stroke. This
          // is the sampler's own rule, in engine/input/pointer-sampler.ts.
          if (
            !event.isPrimary ||
            (event.pointerType === "mouse" && event.button !== 0) ||
            isViewPanButton(event) ||
            sampling ||
            event.altKey
          )
            return
          const selected = findLayer(snapshot.layers, snapshot.activeLayerId)
          // The engine refuses these strokes without a word, so the refusal
          // is said here. Fixed ids keep repeated taps to one toast each.
          if (!selected || selected.kind === "group") return
          // Shapes go on a vector layer (19), and paint does not.
          const shapes = isVectorTool(snapshot.tool)
          if (shapes && selected.kind !== "vector") {
            toast.info("Shapes are drawn on a vector layer.", {
              id: "shape-layer",
              action: {
                label: "Add vector layer",
                onClick: () =>
                  runStudioCommand("layer.addVector", commandContext),
              },
            })
            return
          }
          if (
            !shapes &&
            // The eraser takes whole objects from a vector layer (19).
            snapshot.tool !== "eraser" &&
            selected.kind === "vector" &&
            !selected.locked &&
            !isSelectionTool(snapshot.tool) &&
            !(snapshot.paintingMask && selected.mask)
          ) {
            toast.info(
              <>
                <strong className="font-semibold">{selected.name}</strong> holds
                shapes. Draw on it with the shape and pen tools.
              </>,
              { id: "vector-layer" }
            )
            return
          }
          if (selected.locked)
            toast.info(
              <>
                <strong className="font-semibold">{selected.name}</strong> is
                locked. Unlock it to paint.
              </>,
              { id: "locked-layer" }
            )
          else if (
            selected.kind === "raster" &&
            selected.image &&
            !(snapshot.paintingMask && selected.mask)
          )
            // The refusal is where most artists meet this, so it carries the
            // way through rather than only naming the wall. The mask is named
            // too: it is the undoable way to hide part of a picture, and the
            // conversion is not. Two short lines, because a toast that has to
            // be studied is one the artist dismisses unread.
            toast.info(
              <>
                <strong className="font-semibold">{selected.name}</strong> is a
                placed photo. Paint on it and your marks change the photo. A
                mask hides parts without changing it.
              </>,
              {
                id: "image-layer",
                // Long enough to be read and acted on: the door closing
                // before the artist reaches it is the wall again.
                duration: 12000,
                action: {
                  label: "Paint on it",
                  onClick: () =>
                    void engine?.dispatch({
                      type: "makeLayerPaintable",
                      id: selected.id,
                    }),
                },
              }
            )
        }}
        // Touch and pen gestures belong to the stroke, not to the scroller.
        className="block h-full w-full touch-none"
        // A dot under the hand, so the mark has a visible starting point.
        style={{
          cursor: sampling
            ? SAMPLING_CURSOR
            : snapshot.tool === "moveSelection"
              ? "move"
              : isVectorTool(snapshot.tool)
                ? VECTOR_CURSORS[snapshot.tool]
                : isSelectionTool(snapshot.tool)
                  ? "crosshair"
                  : TOOL_CURSOR,
        }}
      />
      {/* Guides and the straight-edge (16, 17) are drawn with the canvas, so
          before the controls: every panel and rail sits over them (07), and
          they stay when zen puts the controls away. The rulers are controls,
          drawn into a layer after them, and go with zen. */}
      {/* What is on the canvas itself, selection and transform boxes, comes
          first, so the guides are over it and can be taken hold of there. It
          is the artwork's, not a control, so it stays in zen. */}
      {snapshot.status === "ready" && (
        <>
          {engine && (
            <>
              <VectorNodes
                engine={engine}
                snapshot={snapshot}
                canvas={canvasElement}
              />
              <VectorSelection
                engine={engine}
                snapshot={snapshot}
                canvas={canvasElement}
              />
              <PolygonHint snapshot={snapshot} />
            </>
          )}
          {engine && snapshot.vectorTransform && (
            <VectorTransform
              engine={engine}
              snapshot={snapshot}
              canvas={canvasElement}
            />
          )}
          {engine && snapshot.imageTransform && (
            <ImageTransform
              engine={engine}
              snapshot={snapshot}
              canvas={canvasElement}
            />
          )}
          {engine && snapshot.layerTransform && (
            <LayerTransform
              engine={engine}
              snapshot={snapshot}
              canvas={canvasElement}
            />
          )}
        </>
      )}
      {snapshot.status === "ready" && engine && (
        <>
          <RulersAndGuides
            engine={engine}
            snapshot={snapshot}
            canvas={canvasElement}
            rulerLayer={rulerLayer}
          />
          <EraserTrail
            canvas={canvasElement}
            active={snapshot.tool === "eraser"}
          />
          <SizeCursor
            canvas={canvasElement}
            active={smudging}
            radius={snapshot.smudge.radius}
            zoom={snapshot.view.zoom}
          />
          {snapshot.straightEdge && (
            <StraightEdgeOverlay
              engine={engine}
              snapshot={snapshot}
              canvas={canvasElement}
            />
          )}
        </>
      )}
      {snapshot.status === "ready" && (
        // The controls float in a box that steps in past the rulers while
        // they show, so nothing sits under them; only the controls move, never
        // the canvas. The box itself lets the pointer through to the canvas.
        <div
          className="pointer-events-none absolute right-0 bottom-0 motion-safe:transition-[top,left] motion-safe:duration-150 motion-safe:ease-out [&>*:not(.pointer-events-none)]:pointer-events-auto"
          style={{
            top: snapshot.rulersVisible ? RULER_SIZE : 0,
            left: snapshot.rulersVisible ? RULER_SIZE : 0,
          }}
          hidden={zen}
          data-testid="studio-chrome"
        >
          <div className="pointer-events-none absolute top-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-studio-edge bg-studio-surface/85 px-4 py-1.5 text-xs shadow-sm backdrop-blur">
            <span>{documentName || DEFAULT_DOCUMENT_NAME}</span>
            {snapshot.loading && (
              <span className="text-muted-foreground" data-testid="load-status">
                Loading…
              </span>
            )}
            {remote && (
              <span
                className="text-muted-foreground"
                data-testid="sync-status"
                data-sync-status={snapshot.syncStatus ?? undefined}
              >
                {syncStatusLabel(snapshot.syncStatus)}
              </span>
            )}
            {!remote && documentId && (
              <>
                <span className="text-muted-foreground">
                  Saved on this device
                </span>
                <Button asChild size="sm" className="pointer-events-auto">
                  {/* A full navigation is deliberate: where OPFS is absent,
                      AnonymousStudio's beforeunload guard must get a chance to
                      stop in-memory work from being discarded. */}
                  {/* oxlint-disable-next-line next/no-html-link-for-pages */}
                  <a href="/signin">Sign in to keep it</a>
                </Button>
              </>
            )}
          </div>
          {snapshot.problem && (
            <div
              role="alert"
              data-recovery-action={snapshot.problem.action}
              className="absolute top-14 left-1/2 max-w-xl -translate-x-1/2 rounded-lg border border-destructive/40 bg-studio-surface/95 px-4 py-3 text-sm shadow-lg"
            >
              {snapshot.problem.message}
            </div>
          )}
          {openElsewhere && (
            <div
              role="alert"
              data-testid="open-elsewhere-warning"
              className="pointer-events-none absolute top-14 left-1/2 -translate-x-1/2 rounded-full border border-amber-500/50 bg-amber-950/90 px-4 py-1.5 text-xs text-amber-200 shadow-sm backdrop-blur"
            >
              Also open on another device — work here may conflict with it.
            </div>
          )}

          <div className="absolute top-3 left-3 flex gap-1 rounded-xl border border-studio-edge bg-studio-surface/88 p-1.5 shadow-lg backdrop-blur-xl">
            {libraryHref && (
              <>
                {/* An in-app navigation: unmounting the canvas sends what has
                    not synced yet, so leaving this way loses nothing. */}
                <IconButton
                  variant="ghost"
                  size="icon"
                  label="Back to documents"
                  side="bottom"
                  className="rounded-lg aria-disabled:pointer-events-none aria-disabled:opacity-50"
                  asChild
                >
                  {/* Not while a version is being opened or taken back:
                      leaving mid-way would sync that half-finished state as
                      the document. A link cannot be disabled, so it refuses
                      the click instead. */}
                  <Link
                    href={libraryHref}
                    aria-disabled={historyBusy || undefined}
                    tabIndex={historyBusy ? -1 : undefined}
                    onClick={(event) => {
                      if (historyBusy) event.preventDefault()
                    }}
                  >
                    <ArrowLeftIcon />
                  </Link>
                </IconButton>
                <span
                  aria-hidden
                  className="mx-0.5 w-px self-stretch bg-studio-edge"
                />
              </>
            )}
            {engine && (
              <ExportDialog
                engine={engine}
                runCommand={(id) => runStudioCommand(id, commandContext)}
              />
            )}
            <IconButton
              variant="ghost"
              size="icon"
              label="Undo"
              command="edit.undo"
              side="bottom"
              disabled={!snapshot.canUndo || historyBusy}
              onClick={() => runStudioCommand("edit.undo", commandContext)}
              className="rounded-lg"
            >
              <ArrowUUpLeftIcon />
            </IconButton>
            <IconButton
              variant="ghost"
              size="icon"
              label="Redo"
              command="edit.redo"
              side="bottom"
              disabled={!snapshot.canRedo || historyBusy}
              onClick={() => runStudioCommand("edit.redo", commandContext)}
              className="rounded-lg"
            >
              <ArrowUUpRightIcon />
            </IconButton>
            {/* Beside undo and redo because it is the same kind of control —
                a way through the document's past — and the panel hangs from
                the button that opened it. Restore points only exist for a
                document with a cloud copy behind it (§9.4), so an anonymous
                local document is not shown a door to them. */}
            {remote && (
              <div className="relative">
                <IconButton
                  variant={historyOpen ? "default" : "ghost"}
                  size="icon"
                  label="Version history"
                  side="bottom"
                  aria-pressed={historyOpen}
                  aria-expanded={historyOpen}
                  // Closing while a version is still being opened would let
                  // it land after the panel had gone, with nothing left to
                  // take it back — the same reason the panel's own close
                  // waits.
                  // Nor while tiles are still loading: they would land on top
                  // of a version previewed now, and restoring it would keep
                  // that mix.
                  disabled={historyBusy || (snapshot.loading && !historyOpen)}
                  onClick={() => {
                    if (historyOpen) void closeHistory()
                    else {
                      setColorOpen(false)
                      setHistoryOpen(true)
                    }
                  }}
                  className="rounded-lg"
                >
                  <ClockCounterClockwiseIcon />
                </IconButton>
                {engine && historyOpen && (
                  <VersionPanel
                    engine={engine}
                    onClose={() => void closeHistory()}
                    onPreviewStateChange={setVersionPreview}
                    locked={historyBusy}
                    className="absolute top-full left-0 mt-3.5"
                  />
                )}
              </div>
            )}
          </div>

          <TooltipProvider delayDuration={350}>
            {/* One column holds both rails, so the gap between them stays the
              same however tall the adjustments grow. On a window too short
              for both (05) the column scrolls, never the studio under it, and
              ends 12px short of the bottom edge. Its side and bottom padding
              is the margin the rails had, so their shadows are not cut off;
              it starts where the rails do, so the canvas above them still
              takes strokes. It takes the pointer, padding and all, so its
              scrollbar can be dragged. Its top and its height share one
              offset. */}
            {/* The rails and, beside them, what only the tool in the hand
                offers: those come and go with the tool, so they sit in a card
                of their own rather than stretching the rails, which keep one
                height whichever tool is held. */}
            <div className="pointer-events-none absolute top-[4.375rem] bottom-0 left-0 flex items-start">
              <div
                data-testid="tool-rails"
                className="pointer-events-auto flex max-h-full flex-col gap-3 overflow-y-auto overscroll-contain px-3 pb-3 [scrollbar-width:thin] *:shrink-0"
              >
                <div
                  aria-label="Brush adjustments"
                  className="flex flex-col items-center gap-1 rounded-xl border border-studio-edge bg-studio-surface/88 p-1.5 shadow-lg backdrop-blur-xl"
                >
                  {snapshot.tool === "pressure" ||
                  ((snapshot.tool === "node" ||
                    snapshot.tool === "objectSelect") &&
                    snapshot.vectorSelection.length > 0) ? (
                    <PopoverPrimitive.Root
                      modal
                      open={vectorBrushOpen}
                      onOpenChange={setVectorBrushOpen}
                    >
                      <PopoverPrimitive.Trigger asChild>
                        <IconButton
                          variant="ghost"
                          size="sm"
                          label={`Choose vector brush: ${snapshot.vectorBrush.name}`}
                          side="right"
                          className="size-8 rounded-lg p-0"
                        >
                          <VectorBrushToolIcon
                            kind={
                              snapshot.vectorBrushPressure
                                ? "pressure"
                                : "solid"
                            }
                          />
                        </IconButton>
                      </PopoverPrimitive.Trigger>
                      <PopoverPrimitive.Portal>
                        <PopoverPrimitive.Content
                          onCloseAutoFocus={returnFocusForKeysOnly}
                          side="right"
                          align="end"
                          sideOffset={10}
                          collisionPadding={12}
                          aria-label="Choose a vector brush"
                          className="scroll-rounded z-50 max-h-[var(--radix-popover-content-available-height)] w-72 overflow-y-auto rounded-xl border bg-background p-3 shadow-xl"
                        >
                          <VectorBrushLibrary
                            library={vectorBrushLibrary}
                            store={vectorBrushStore}
                            current={snapshot.vectorBrush}
                            select={(brush) => {
                              void engine?.dispatch({
                                type: "setVectorBrush",
                                brush,
                              })
                            }}
                            apply={(brush) => {
                              void engine?.dispatch({
                                type: "applyVectorBrush",
                                brush,
                              })
                            }}
                            canApply={snapshot.vectorSelection.length > 0}
                            makeArt={(kind) => {
                              if (!engine)
                                throw new Error("The canvas is not ready.")
                              return kind === "scatter"
                                ? engine.scatterBrushFromSelection()
                                : engine.patternBrushFromSelection()
                            }}
                            close={() => setVectorBrushOpen(false)}
                          />
                        </PopoverPrimitive.Content>
                      </PopoverPrimitive.Portal>
                    </PopoverPrimitive.Root>
                  ) : snapshot.tool === "eraser" ? (
                    <PopoverPrimitive.Root
                      modal
                      open={eraserOpen}
                      onOpenChange={setEraserOpen}
                    >
                      <PopoverPrimitive.Trigger asChild>
                        <IconButton
                          variant="ghost"
                          size="sm"
                          label={`Choose eraser: ${snapshot.eraser.name}`}
                          side="right"
                          className="size-8 rounded-lg p-0"
                        >
                          <span className="flex items-center gap-2">
                            <EraserToolIcon
                              kind={
                                snapshot.eraser.id === "eraser:pressure"
                                  ? "pressure"
                                  : "solid"
                              }
                            />
                          </span>
                        </IconButton>
                      </PopoverPrimitive.Trigger>
                      <PopoverPrimitive.Portal>
                        <PopoverPrimitive.Content
                          onCloseAutoFocus={returnFocusForKeysOnly}
                          side="right"
                          align="end"
                          sideOffset={10}
                          collisionPadding={12}
                          aria-label="Choose an eraser"
                          className="scroll-rounded z-50 max-h-[var(--radix-popover-content-available-height)] w-72 overflow-y-auto rounded-xl border bg-background p-3 shadow-xl"
                        >
                          <h2 className="mb-2 text-sm font-medium">Erasers</h2>
                          {(["solid", "pressure"] as const).map((kind) => (
                            <button
                              key={kind}
                              type="button"
                              aria-pressed={
                                snapshot.eraser.id === `eraser:${kind}`
                              }
                              className="mb-1 flex w-full items-center gap-3 rounded-lg border border-transparent p-3 text-left hover:bg-muted aria-pressed:border-primary aria-pressed:bg-primary/10"
                              onClick={() => {
                                void engine?.dispatch({
                                  type: "setEraser",
                                  kind,
                                })
                                setEraserOpen(false)
                              }}
                            >
                              <EraserToolIcon kind={kind} className="size-5" />
                              <span>
                                <span className="block text-xs font-medium">
                                  {kind === "solid"
                                    ? "Solid eraser"
                                    : "Pressure eraser"}
                                </span>
                                <span className="block text-[10px] text-muted-foreground">
                                  {kind === "solid"
                                    ? "Hard edge · constant size at any pressure"
                                    : "Hard edge · press harder for a wider erase"}
                                </span>
                              </span>
                            </button>
                          ))}
                        </PopoverPrimitive.Content>
                      </PopoverPrimitive.Portal>
                    </PopoverPrimitive.Root>
                  ) : (
                    <PopoverPrimitive.Root
                      modal
                      open={libraryOpen}
                      onOpenChange={setLibraryOpen}
                    >
                      <PopoverPrimitive.Trigger asChild>
                        <IconButton
                          variant="ghost"
                          size="sm"
                          label={`Choose brush: ${snapshot.brush.name}`}
                          side="right"
                          className="relative size-8 rounded-lg p-0"
                        >
                          {/* The corner mark says this opens a choice of brushes; without
                        it the button reads as the brush tool itself. */}
                          <BrushIcon
                            id={snapshot.brush.id}
                            className="shrink-0"
                          />
                          <MenuNotch />
                        </IconButton>
                      </PopoverPrimitive.Trigger>
                      <PopoverPrimitive.Portal>
                        <PopoverPrimitive.Content
                          onCloseAutoFocus={returnFocusForKeysOnly}
                          side="right"
                          align="start"
                          sideOffset={10}
                          collisionPadding={12}
                          aria-label="Choose a brush"
                          className="scroll-rounded z-50 max-h-[min(36rem,var(--radix-popover-content-available-height))] w-80 max-w-[calc(100vw-24px)] overflow-y-auto rounded-xl border bg-background shadow-xl outline-none"
                        >
                          {engine && (
                            <BrushLibrary
                              library={library}
                              store={brushStore}
                              brush={snapshot.brush}
                              edited={brushEdited}
                              onSelect={(next, keepOpen) => {
                                void engine.dispatch(brushCommand(next))
                                setSavedBrush(next)
                                if (!keepOpen) setLibraryOpen(false)
                              }}
                              onClose={() => setLibraryOpen(false)}
                              onImport={(files) =>
                                studioImport(files, {
                                  store: brushStore,
                                  shipped: KRITA_TEXTURES,
                                  register: (id, texture) =>
                                    engine.dispatch({
                                      type: "registerTexture",
                                      id,
                                      texture,
                                    }),
                                })
                              }
                            />
                          )}
                        </PopoverPrimitive.Content>
                      </PopoverPrimitive.Portal>
                    </PopoverPrimitive.Root>
                  )}
                  {/* Size and opacity are the two a hand reaches for mid-piece, so
                they stay on the canvas: the editor is for shaping a brush,
                not for the adjustment made between one stroke and the next. */}
                  {/* One size for whatever is in the hand: a brush's tip, or the
                  width a vector tool outlines with — the same width the shape
                  options set, so the two are one control, not two. */}
                  <QuickSetting
                    label={vectorWidth ? "Width" : "Size"}
                    value={
                      vectorWidth
                        ? `${shapeOptions.strokeWidth} px`
                        : `${(tipRadius * 2).toFixed(1)} px`
                    }
                    readout={`${Math.round(sizeRadius * 2)}`}
                    icon={
                      // The dot grows with the brush, up to the icon's own size.
                      <CircleIcon
                        weight="fill"
                        style={{
                          transform: `scale(${Math.min(1, 0.45 + sizeRadius / 40)})`,
                        }}
                      />
                    }
                  >
                    {vectorWidth ? (
                      <SliderSetting
                        label="Outline width"
                        value={shapeOptions.strokeWidth}
                        min={1}
                        max={64}
                        step={1}
                        unit="px"
                        disabled={!shapeOptions.stroke}
                        onChange={(strokeWidth) =>
                          void engine
                            ?.dispatch({ type: "setShapeStyle", strokeWidth })
                            .catch(() => {})
                        }
                      />
                    ) : (
                      <SliderSetting
                        label="Size"
                        value={tipRadius}
                        min={0.5}
                        max={200}
                        step={0.5}
                        scale={2}
                        decimals={1}
                        unit="px"
                        onChange={setTipRadius}
                      />
                    )}
                  </QuickSetting>
                  {/* Smudge lays nothing down, so it has no opacity to set: in
                  its place is how hard it drags what is already there. */}
                  {smudging ? (
                    <QuickSetting
                      label="Strength"
                      value={`${Math.round(snapshot.smudge.strength * 100)}%`}
                      readout={`${Math.round(snapshot.smudge.strength * 100)}%`}
                      icon={<SmudgeToolIcon />}
                    >
                      <SliderSetting
                        label="Strength"
                        value={snapshot.smudge.strength}
                        min={0}
                        max={1}
                        step={0.01}
                        scale={100}
                        unit="%"
                        onChange={(strength) =>
                          void engine?.dispatch({ type: "setSmudge", strength })
                        }
                      />
                    </QuickSetting>
                  ) : (
                    <QuickSetting
                      label="Opacity"
                      value={`${Math.round(activeTip.rendering.opacity * 100)}%`}
                      readout={`${Math.round(activeTip.rendering.opacity * 100)}%`}
                      icon={<DropHalfIcon />}
                    >
                      <SliderSetting
                        label="Opacity"
                        value={activeTip.rendering.opacity}
                        min={0}
                        max={1}
                        step={0.01}
                        scale={100}
                        unit="%"
                        onChange={(opacity) =>
                          void engine?.dispatch({
                            type:
                              snapshot.tool === "eraser"
                                ? "setEraser"
                                : "setBrush",
                            opacity,
                          })
                        }
                      />
                    </QuickSetting>
                  )}
                  <QuickSetting
                    label="Smoothing"
                    value={`${Math.round(snapshot.stabilization * 100)}%`}
                    readout={`${Math.round(snapshot.stabilization * 100)}%`}
                    icon={<WaveSineIcon />}
                  >
                    <SliderSetting
                      label="Smoothing"
                      value={snapshot.stabilization}
                      min={0}
                      max={1}
                      step={0.01}
                      scale={100}
                      unit="%"
                      onChange={(strength) =>
                        void engine?.dispatch({
                          type: "setStabilization",
                          strength,
                        })
                      }
                    />
                  </QuickSetting>
                  {/* Pen response is a calibration rather than an adjustment, so it
                sits behind a popover instead of taking a fourth slider: an
                artist sets it once for their hand and then leaves it. It is
                here rather than only in app settings because the thing it has
                to be judged against is the canvas. */}
                  <PopoverPrimitive.Root
                    modal
                    open={pressureOpen}
                    onOpenChange={setPressureOpen}
                  >
                    <PopoverPrimitive.Trigger asChild>
                      <IconButton
                        variant="ghost"
                        size="sm"
                        label="Pen settings"
                        side="right"
                        className="size-8 rounded-lg p-0"
                      >
                        <ChartLineUpIcon />
                      </IconButton>
                    </PopoverPrimitive.Trigger>
                    <PopoverPrimitive.Portal>
                      <PopoverPrimitive.Content
                        onCloseAutoFocus={returnFocusForKeysOnly}
                        side="right"
                        align="start"
                        sideOffset={10}
                        collisionPadding={12}
                        aria-label="Pen settings"
                        title="Pen settings"
                        className="z-50 flex flex-col gap-3 rounded-xl border bg-background p-3 shadow-xl outline-none"
                      >
                        {/* Driven by what the engine holds rather than by state of
                      its own: the curve the artist drags and the curve every
                      sample is shaped by are then the same one. */}
                        <PressureCurve
                          size="md"
                          testArea
                          value={snapshot.pressureCurve}
                          onChange={(curve) => {
                            penStore.setPressureCurve(curve)
                            void engine?.dispatch({
                              type: "setPressureCurve",
                              curve,
                            })
                          }}
                        />
                        {/* Switched off, a pen reads as upright, which is what a
                      noisy or absent tilt sensor needs and what an artist who
                      rests their hand at an angle asks for. */}
                        <TiltToggle
                          enabled={snapshot.tiltEnabled}
                          onChange={(enabled) => {
                            penStore.setTiltEnabled(enabled)
                            void engine?.dispatch({
                              type: "setTiltEnabled",
                              enabled,
                            })
                          }}
                        />
                      </PopoverPrimitive.Content>
                    </PopoverPrimitive.Portal>
                  </PopoverPrimitive.Root>
                </div>
                <div className="flex flex-col items-center gap-1 rounded-xl border border-studio-edge bg-studio-surface/88 p-1.5 shadow-lg backdrop-blur-xl">
                  <ToolGroup label="Paint tools">
                    <RailAction
                      label="Brush tool"
                      detail={WORKS_ON.paint}
                      command="tool.brush"
                      variant={snapshot.tool === "brush" ? "default" : "ghost"}
                      size="icon"
                      aria-pressed={snapshot.tool === "brush"}
                      onClick={() => {
                        setEraserOpen(false)
                        if (snapshot.tool === "brush")
                          setLibraryOpen((open) => !open)
                        runStudioCommand("tool.brush", commandContext)
                      }}
                      className={cn("rounded-lg", brushDimmed && DIMMED_TOOL)}
                    >
                      <BrushIcon id={snapshot.brush.id} />
                    </RailAction>
                    <RailAction
                      label={
                        !vectorErasing
                          ? "Eraser tool"
                          : shapeEraser
                            ? "Shape eraser tool"
                            : "Pixel eraser tool"
                      }
                      detail={
                        vectorErasing
                          ? `${WORKS_ON.eraser}. Press again for the ${shapeEraser ? "pixel" : "shape"} eraser`
                          : WORKS_ON.eraser
                      }
                      command="tool.eraser"
                      variant={snapshot.tool === "eraser" ? "default" : "ghost"}
                      size="icon"
                      aria-pressed={snapshot.tool === "eraser"}
                      onClick={() => {
                        setLibraryOpen(false)
                        if (snapshot.tool === "eraser") {
                          // On a vector layer a second press swaps the
                          // eraser; its tip is chosen beside it, as ever.
                          if (vectorErasing)
                            void engine?.dispatch({
                              type: "setVectorEraser",
                              mode: shapeEraser ? "pixel" : "object",
                            })
                          else setEraserOpen((open) => !open)
                        }
                        runStudioCommand("tool.eraser", commandContext)
                      }}
                      className={cn(
                        "relative rounded-lg",
                        eraserDimmed && DIMMED_TOOL
                      )}
                    >
                      {shapeEraser ? (
                        <ShapeEraserIcon />
                      ) : (
                        <EraserToolIcon
                          kind={
                            snapshot.eraser.id === "eraser:pressure"
                              ? "pressure"
                              : "solid"
                          }
                        />
                      )}
                      {vectorErasing && (
                        <FamilyDots count={2} shown={shapeEraser ? 1 : 0} />
                      )}
                    </RailAction>
                    <RailAction
                      label="Smudge tool"
                      detail={WORKS_ON.paint}
                      command="tool.smudge"
                      variant={snapshot.tool === "smudge" ? "default" : "ghost"}
                      size="icon"
                      aria-pressed={snapshot.tool === "smudge"}
                      onClick={() => {
                        setLibraryOpen(false)
                        setEraserOpen(false)
                        runStudioCommand("tool.smudge", commandContext)
                      }}
                      className={cn("rounded-lg", smudgeDimmed && DIMMED_TOOL)}
                    >
                      <SmudgeToolIcon />
                    </RailAction>
                  </ToolGroup>
                  <RailDivider />
                  <ToolGroup label="Selection tools">
                    {SELECTION_FAMILIES.map((members) => (
                      <ToolFamilySlot
                        key={members[0].tool}
                        members={members}
                        tool={snapshot.tool}
                        onPick={(tool) => {
                          setLibraryOpen(false)
                          setEraserOpen(false)
                          runStudioCommand(`tool.${tool}`, commandContext)
                        }}
                      />
                    ))}
                  </ToolGroup>
                  <RailDivider />
                  <ToolGroup label="Vector tools" dimmed={vectorDimmed}>
                    {VECTOR_RAIL_ORDER.map((tool) => (
                      <RailAction
                        key={tool}
                        label={VECTOR_TOOL_RAIL[tool].label}
                        detail={WORKS_ON.vector}
                        command={`tool.${tool}`}
                        variant={snapshot.tool === tool ? "default" : "ghost"}
                        size="icon"
                        aria-pressed={snapshot.tool === tool}
                        onClick={() => {
                          setLibraryOpen(false)
                          setEraserOpen(false)
                          runStudioCommand(`tool.${tool}`, commandContext)
                        }}
                        className="rounded-lg"
                      >
                        {VECTOR_TOOL_RAIL[tool].icon}
                      </RailAction>
                    ))}
                    <ShapeToolSlot
                      tool={snapshot.tool}
                      onPick={(tool) => {
                        setLibraryOpen(false)
                        setEraserOpen(false)
                        runStudioCommand(`tool.${tool}`, commandContext)
                      }}
                    />
                  </ToolGroup>
                  <RailDivider />
                  <RailAction
                    label="Colour"
                    variant={colorOpen ? "default" : "ghost"}
                    size="icon"
                    aria-pressed={colorOpen}
                    onClick={() => {
                      // The two panels open into the same corner, so one gives
                      // way to the other rather than drawing over it.
                      if (!colorOpen && historyOpen) {
                        // Not while a version is being opened; see the history
                        // button for why closing then would lose track of it.
                        if (historyBusy) return
                        // Opened once the history has gone, not beside it while
                        // a trial is still being taken back.
                        void closeHistory().then(() => setColorOpen(true))
                        return
                      }
                      setColorOpen((open) => !open)
                    }}
                    className="rounded-lg"
                  >
                    {/* The colour in the hand, as painting apps show it, rather
                      than a picture of a palette. */}
                    <span
                      aria-hidden
                      className="size-4.5 rounded-full border border-studio-edge shadow-[inset_0_0_0_1px_rgb(255_255_255/0.25)]"
                      style={{ backgroundColor: snapshot.color.hex }}
                    />
                  </RailAction>
                  <RailAction
                    label="Brush editor"
                    variant={brushOpen ? "default" : "ghost"}
                    size="icon"
                    disabled={snapshot.tool === "eraser"}
                    aria-pressed={brushOpen}
                    ref={brushButton}
                    onClick={() => setBrushOpen((open) => !open)}
                    className="rounded-lg"
                  >
                    <SlidersIcon />
                  </RailAction>
                </div>
              </div>
              {(isVectorTool(snapshot.tool) ||
                snapshot.tool === "magicWand" ||
                snapshot.selection) && (
                <div
                  data-testid="tool-options"
                  aria-label="Tool options"
                  className="pointer-events-auto flex flex-col items-center gap-1 rounded-xl border border-studio-edge bg-studio-surface/88 p-1.5 shadow-lg backdrop-blur-xl"
                >
                  {/* What a new shape is given (19), shown while a shape tool
                is in the hand: filled, outlined, or both, in the current
                colour. */}
                  {isVectorTool(snapshot.tool) && (
                    <QuickSetting
                      label="Shape"
                      value={shapeSummary(shapeOptions)}
                      readout={shapeReadout(shapeOptions)}
                      icon={<ShapePaintIcon style={shapeOptions} />}
                    >
                      <ShapeStylePanel
                        engine={engine}
                        style={shapeOptions}
                        selected={snapshot.selectionStyle !== null}
                        outlineOnly={
                          snapshot.selectionStyle === null &&
                          drawsOutlineOnly(snapshot.tool)
                        }
                        currentColor={snapshot.color.hex}
                        joinable={{
                          merge: canJoin(
                            snapshot.vectorPaths,
                            snapshot.tool === "node"
                              ? snapshot.vectorNodes
                              : [],
                            "merge",
                            snapshot.vectorSelection
                          ),
                          segment: canJoin(
                            snapshot.vectorPaths,
                            snapshot.tool === "node"
                              ? snapshot.vectorNodes
                              : [],
                            "segment",
                            snapshot.vectorSelection
                          ),
                        }}
                        curves={snapshot.vectorPaths.length > 0}
                        runCommand={runShapeCommand}
                      />
                    </QuickSetting>
                  )}
                  {/* How far a solid vector stroke narrows to each tip. It
                comes and goes with the brush, so it is here with the shape
                options, never on the rail, whose height stays put. */}
                  {snapshot.tool === "pressure" &&
                    !snapshot.vectorBrushPressure && (
                      <QuickSetting
                        label="Taper"
                        value={taperSummary(snapshot.vectorBrushTaper)}
                        readout={taperReadout(snapshot.vectorBrushTaper)}
                        icon={<TaperIcon />}
                      >
                        <div className="space-y-2">
                          {(["start", "end"] as const).map((end) => (
                            <SliderSetting
                              key={end}
                              label={
                                end === "start" ? "Start taper" : "End taper"
                              }
                              value={snapshot.vectorBrushTaper[end]}
                              min={0}
                              max={MAX_TAPER}
                              step={0.01}
                              scale={100}
                              unit="%"
                              onChange={(share) =>
                                void engine
                                  ?.dispatch({
                                    type: "setVectorBrushTaper",
                                    [end]: share,
                                  })
                                  .catch(() => {})
                              }
                            />
                          ))}
                        </div>
                      </QuickSetting>
                    )}
                  {/* The wand's own options (10), shown while it is in the hand:
                how far a colour may stray, and whether it reads the layer
                or the picture as a whole. */}
                  {snapshot.tool === "magicWand" && (
                    <QuickSetting
                      label="Tolerance"
                      value={`${snapshot.wand.tolerance}, ${snapshot.wand.sample === "layer" ? "active layer" : "all layers"}`}
                      readout={`${snapshot.wand.tolerance}`}
                      icon={<MagicWandIcon />}
                    >
                      <SliderSetting
                        label="Tolerance"
                        value={snapshot.wand.tolerance}
                        min={0}
                        max={255}
                        step={1}
                        onChange={(tolerance) =>
                          void engine?.dispatch({
                            type: "setWandOptions",
                            tolerance,
                          })
                        }
                      />
                      <div
                        role="group"
                        aria-label="Sample"
                        className="mt-3 grid grid-cols-2 gap-1 text-xs"
                      >
                        {(["layer", "composite"] as const).map((sample) => (
                          <button
                            key={sample}
                            type="button"
                            aria-pressed={snapshot.wand.sample === sample}
                            className="rounded-md border border-transparent px-2 py-1 hover:bg-muted aria-pressed:border-primary aria-pressed:bg-primary/10"
                            onClick={() =>
                              void engine?.dispatch({
                                type: "setWandOptions",
                                sample,
                              })
                            }
                          >
                            {sample === "layer" ? "Active layer" : "All layers"}
                          </button>
                        ))}
                      </div>
                    </QuickSetting>
                  )}
                  {/* What can be done with a selection once there is one (11):
                its edges softened, and what it covers lifted to a layer. */}
                  {snapshot.selection && (
                    <QuickSetting
                      label="Feather"
                      value={`${featherRadius} px`}
                      readout={`${featherRadius}`}
                      icon={<DropHalfIcon />}
                    >
                      <div className="grid grid-cols-2 gap-1 text-xs">
                        <button
                          type="button"
                          className="rounded-md border border-studio-edge px-2 py-1 hover:bg-muted"
                          onClick={() =>
                            runStudioCommand("select.feather", commandContext)
                          }
                        >
                          Feather…
                        </button>
                        <button
                          type="button"
                          className="flex items-center justify-center gap-1 rounded-md border border-studio-edge px-2 py-1 hover:bg-muted"
                          onClick={() =>
                            runStudioCommand(
                              "select.copyToLayer",
                              commandContext
                            )
                          }
                        >
                          <CopySimpleIcon /> To layer
                        </button>
                      </div>
                    </QuickSetting>
                  )}
                </div>
              )}
            </div>
          </TooltipProvider>

          {engine && colorOpen && (
            <aside className="scroll-rounded absolute top-16 left-16 z-10 max-h-[calc(100dvh-5rem)] w-72 max-w-[calc(100vw-5rem)] overflow-y-auto rounded-xl border border-studio-edge bg-studio-surface/95 shadow-xl backdrop-blur-xl">
              <ColorPanel
                engine={engine}
                snapshot={snapshot}
                store={paletteStore}
                onClose={() => setColorOpen(false)}
              />
            </aside>
          )}
          {/* One column down the right edge — panels trigger, layers, brush
              editor, view controls — so the gaps between them come from the
              layout and match the tool rail's rather than from an offset
              guessed against the view controls' height. The column itself
              lets strokes through; only what is in it takes the pointer. */}
          <div
            className={cn(
              "pointer-events-none absolute top-3 right-3 bottom-3 flex max-w-[calc(100vw-6rem)] flex-col items-end gap-3",
              // The editor docks here beside the layers, so the column widens
              // for its mapping rows while it is open.
              brushOpen ? "w-80" : "w-72"
            )}
          >
            {/* Folded, the layers leave a labelled tab where their header
                was, so the control and the panel it restores read as one
                thing — and the brush editor below cannot be mistaken for
                what it opens. */}
            {engine && !panelsOpen && (
              <Button
                ref={layersToggle}
                variant="secondary"
                size="sm"
                aria-expanded={false}
                aria-label="Expand layers"
                onClick={() => {
                  layersToggled.current = true
                  setPanelsOpen(true)
                }}
                className="pointer-events-auto h-10 shrink-0 gap-2 rounded-xl border border-studio-edge bg-studio-surface/88 px-3 text-xs font-semibold tracking-wide uppercase shadow-xl backdrop-blur-xl"
              >
                <StackIcon />
                Layers
                <CaretDownIcon />
              </Button>
            )}
            {engine && panelsOpen && (
              <aside
                className={cn(
                  "scroll-rounded pointer-events-auto flex min-h-0 w-full flex-col overflow-y-auto rounded-xl border border-studio-edge bg-studio-surface/88 shadow-xl backdrop-blur-xl",
                  // The layers keep their height and the editor below them
                  // scrolls, up to half the column so a long stack cannot
                  // crowd the editor out.
                  brushOpen ? "max-h-1/2 shrink-0" : "shrink"
                )}
              >
                <LayerPanel
                  engine={engine}
                  snapshot={snapshot}
                  collapseRef={layersToggle}
                  runCommand={(id, layerId) =>
                    runStudioCommand(id, { ...commandContext, layerId })
                  }
                  onCollapse={() => {
                    layersToggled.current = true
                    setPanelsOpen(false)
                  }}
                />
              </aside>
            )}
            {/* The eraser has no editor, so the editor steps aside while it is
                in the hand rather than showing a brush the next stroke will
                not use. */}
            {engine && brushOpen && snapshot.tool !== "eraser" && (
              <aside
                ref={brushPanel}
                className="scroll-rounded pointer-events-auto flex min-h-0 w-full shrink flex-col overflow-y-auto rounded-xl border border-studio-edge bg-studio-surface/88 shadow-xl backdrop-blur-xl"
              >
                <BrushEditor
                  brush={snapshot.brush}
                  textures={snapshot.textures}
                  textureNames={textureNames}
                  edited={brushEdited}
                  onClose={() => {
                    setBrushOpen(false)
                    // As the popovers do: focus back for the keyboard only,
                    // or the button's tooltip opens under a moved-on pointer.
                    if (!lastInputWasPointer()) brushButton.current?.focus()
                  }}
                  onEdit={(next) => void engine.dispatch(brushCommand(next))}
                  onImportTexture={async (files, kind) => {
                    const tip =
                      kind === "tip"
                        ? await readTipFiles(
                            await readFiles(files),
                            decodeImage
                          )
                        : undefined
                    const texture =
                      tip?.texture ?? (await readTextureFile(files[0]))
                    const id = await brushStore.saveTexture(
                      tip?.name ?? files[0].name.replace(/\.[^.]+$/, ""),
                      texture
                    )
                    // Registered here as well as by the sync effect, so
                    // the texture is selectable in the editor that
                    // imported it rather than only once the store has
                    // answered.
                    await engine.dispatch({
                      type: "registerTexture",
                      id,
                      texture,
                    })
                    return { id, selection: tip?.selection }
                  }}
                  problem={brushProblem}
                  onSave={() => {
                    const working = snapshot.brush
                    const stored = library.brushes.find(
                      (brush) => brush.id === working.id
                    )
                    setBrushProblem(null)
                    // A built-in has no row to write over, so saving an edit
                    // to one keeps it and creates the artist's own brush
                    // beside it — which is what makes a shipped brush a
                    // starting point rather than a dead end.
                    const write: Promise<Brush> = stored
                      ? brushStore
                          .update(stored.id, working)
                          .then(() => working)
                      : brushStore
                          .save(working.name, setForNewBrush(stored), working)
                          .then(async (id) => {
                            // The brush in the hand becomes the brush that
                            // was saved, id and all: without that, the editor
                            // would go on measuring it against something it
                            // no longer is and call a saved brush unsaved.
                            const next = { ...working, id }
                            await engine.dispatch(brushCommand(next))
                            return next
                          })
                    void write.then(setSavedBrush, (error: unknown) =>
                      setBrushProblem(
                        error instanceof Error
                          ? error.message
                          : "That brush could not be saved."
                      )
                    )
                  }}
                  onRevert={() => void engine.dispatch(brushCommand(saved))}
                />
              </aside>
            )}
            <TooltipProvider delayDuration={350}>
              <div
                aria-label="View controls"
                className="pointer-events-auto mt-auto flex shrink-0 flex-col items-center gap-0.5 rounded-xl border border-studio-edge bg-studio-surface/88 p-1.5 shadow-lg backdrop-blur-xl"
              >
                {/* Typed as a percentage, dispatched as a factor: the view only
                    knows how to scale by a ratio, and the ratio that lands on the
                    asked-for zoom is that zoom over the current one. */}
                <NumberField
                  label="Zoom level"
                  value={snapshot.view.zoom * 100}
                  min={MIN_ZOOM * 100}
                  max={MAX_ZOOM * 100}
                  step={1}
                  decimals={0}
                  unit="%"
                  className="w-10"
                  onCommit={(percent) =>
                    void engine?.dispatch({
                      type: "zoomView",
                      factor: percent / 100 / snapshot.view.zoom,
                    })
                  }
                />
                {viewActions.map(([id, icon]) => (
                  <Tooltip key={id}>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={studioCommands.get(id)?.label}
                        aria-pressed={
                          id === "view.flip" ? snapshot.view.flipped : undefined
                        }
                        onClick={() => runStudioCommand(id, commandContext)}
                        className="rounded-lg"
                      >
                        {icon}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="left" sideOffset={8}>
                      {studioCommands.get(id)?.label}
                      <KeybindHint registry={commands} id={id} />
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>
            </TooltipProvider>
          </div>

          {imageOverCanvas && (
            <div
              role="status"
              className="pointer-events-none absolute inset-3 grid place-items-center rounded-xl border-2 border-dashed border-brand-gold/70 bg-studio-surface/20"
            >
              <span className="rounded-lg bg-studio-surface/95 px-4 py-2 text-sm shadow-lg">
                Drop to place the image on its own layer
              </span>
            </div>
          )}

          {imageProblem && (
            <div
              role="alert"
              className="absolute bottom-5 left-1/2 -translate-x-1/2 rounded-lg border border-destructive/40 bg-studio-surface/95 px-4 py-2 text-sm shadow-lg"
            >
              {imageProblem}
            </div>
          )}
        </div>
      )}
      {/* The rulers' own layer, over the controls; see the guides above. */}
      <div
        ref={setRulerLayer}
        className="pointer-events-none absolute inset-0"
        hidden={zen || snapshot.status !== "ready"}
      />
      {/* Zen's one mark: says the controls are put away, not broken, and
          brings them back. */}
      {zen && snapshot.status === "ready" && (
        <IconButton
          label="Leave zen mode"
          command="view.zen"
          side="right"
          variant="ghost"
          // A white dot that subtracts itself from whatever is beneath: dark
          // on light paint, light on dark. The blend sits on the button, not
          // the dot, as opacity on the button would blend the dot only with
          // the button.
          className="group absolute top-2 left-2 size-6 rounded-full p-0 mix-blend-difference hover:bg-transparent dark:hover:bg-transparent"
          onClick={() => setZen(false)}
        >
          <span
            aria-hidden
            className="size-1.5 shrink-0 rounded-full bg-white transition-transform group-hover:scale-150"
          />
        </IconButton>
      )}
      {snapshot.status !== "ready" && (
        <div className="absolute inset-0 grid place-items-center bg-background p-6">
          <section
            className="max-w-md space-y-4"
            role="status"
            aria-live="polite"
          >
            <h1 className="font-heading-display font-heading text-4xl">
              {unavailable
                ? "WebGPU is needed to draw"
                : failed
                  ? "Your graphics device could not start"
                  : "Preparing your canvas…"}
            </h1>
            {unavailable && (
              <>
                <p className="text-muted-foreground">
                  Velura uses WebGPU to paint. This browser or graphics device
                  isn’t making WebGPU available.
                </p>
                <p className="text-muted-foreground">
                  Try an up-to-date Chrome or Edge, or Safari or Firefox on a
                  supported operating system. Availability depends on your
                  hardware and graphics drivers. Enable hardware acceleration
                  and open Velura over HTTPS (or localhost).
                </p>
              </>
            )}
            {failed && (
              <>
                <p className="text-muted-foreground">
                  {snapshot.problem?.message ??
                    "The graphics device could not start. Retry once; if it fails again, reload Velura or restart the browser."}
                </p>
                <button
                  data-recovery-action={snapshot.problem?.action ?? "retry"}
                  className="rounded-md bg-primary px-4 py-2 text-primary-foreground"
                  onClick={() => void engine?.dispatch({ type: "initialize" })}
                >
                  Try again
                </button>
              </>
            )}
          </section>
        </div>
      )}
      {engine && <FilterDialog engine={engine} open={snapshot.filter} />}
      <FeatherDialog
        open={featherOpen}
        radius={featherRadius}
        onOpenChange={setFeatherOpen}
        onApply={(radius) => {
          setFeatherRadius(radius)
          void engine?.dispatch({ type: "featherSelection", radius })
        }}
      />
      <ConfirmLayerDialog
        confirming={confirming}
        onOpenChange={(open) => !open && setConfirming(null)}
        onConfirm={({ layer, action }) =>
          void engine?.dispatch(
            action === "clear"
              ? { type: "clearLayer", id: layer.id }
              : { type: "removeLayer", id: layer.id }
          )
        }
      />
      <PreferencesPanel
        defaults={studioCommands}
        open={preferencesOpen}
        onOpenChange={setPreferencesOpen}
      />
      <CommandPalette
        registry={commands}
        context={commandContext}
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        toggleId={PALETTE_COMMAND}
      />
    </main>
  )
}
