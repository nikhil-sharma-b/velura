"use client"

import {
  CaretDownIcon,
  ArrowClockwiseIcon,
  ArrowsClockwiseIcon,
  ClockCounterClockwiseIcon,
  ArrowCounterClockwiseIcon,
  ArrowUUpLeftIcon,
  ArrowUUpRightIcon,
  CornersOutIcon,
  CircleIcon,
  DropHalfIcon,
  WaveSineIcon,
  ChartLineUpIcon,
  FlipHorizontalIcon,
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon,
  PaletteIcon,
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
import type { ComponentProps } from "react"
import type { Brush } from "@/engine/brush/brush"
import {
  createEngine,
  type Engine,
  type EngineCommand,
  INITIAL_SNAPSHOT,
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
import { readTextureFile } from "../lib/texture-import"
import { BrushEditor } from "./brush-editor"
import { ImageTransform } from "./image-transform"
import { SAMPLING_CURSOR, TOOL_CURSOR } from "../lib/tool-cursor"
import { BrushIcon, EraserToolIcon } from "./brush-icon"
import { BrushLibrary } from "./brush-library"
import { TiltToggle } from "./tilt-toggle"
import { IconButton } from "./icon-button"
import { NumberField, SliderSetting } from "./slider-setting"
import { LayerPanel } from "./layer-panel"
import { VersionPanel } from "./version-panel"
import { ExportDialog } from "./export-dialog"

/** One press of a zoom key or button, which is a comfortable step by eye. */
const ZOOM_STEP = 1.25
/** One press of a rotate key: fifteen degrees, so a quarter turn is six. */
const ROTATE_STEP = Math.PI / 12
/** One press of an arrow key, in CSS pixels: a nudge, not a leap. */
const PAN_STEP = 40
/**
 * One press of a size key. Multiplicative, because the step an artist wants
 * between 2px and 3px is not the step they want between 100px and 101px.
 */
const SIZE_STEP = 1.15
/** The radius bounds the size slider offers, so the keys cannot leave them. */
const MIN_RADIUS = 0.5
const MAX_RADIUS = 200

function RailAction({
  side = "right",
  ...props
}: ComponentProps<typeof IconButton>) {
  return <IconButton {...props} side={side} className="rounded-lg" />
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
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger asChild>
        <IconButton
          label={`${label}: ${value}`}
          side="right"
          variant="ghost"
          className="h-auto w-8 flex-col gap-0.5 rounded-lg px-0 py-1"
        >
          {icon}
          <span className="text-[10px] leading-none font-medium text-foreground/75 tabular-nums">
            {readout}
          </span>
        </IconButton>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
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

/**
 * The navigation a key asks for, or nothing. Unmodified keys, because the
 * hand reaching for them is the one not holding the pen.
 */
function navigationForKey(
  key: string,
  shift: boolean
): EngineCommand | undefined {
  switch (key) {
    case "+":
    case "=":
      return { type: "zoomView", factor: ZOOM_STEP }
    case "-":
    case "_":
      return { type: "zoomView", factor: 1 / ZOOM_STEP }
    case "0":
      // Fit is the overview; with shift it is the way back to square. The
      // shifted key arrives as `)` on a US layout and as `0` on the layouts
      // that put a digit there unshifted, so both spellings mean the same key.
      return shift ? { type: "resetView" } : { type: "fitView" }
    case ")":
      return { type: "resetView" }
    // The brackets are size (see `sizeForKey`); rotation takes the pair beside
    // them, which is where Krita and Blender put a step through an angle too.
    case ",":
    case "<":
      return { type: "rotateView", radians: -ROTATE_STEP }
    case ".":
    case ">":
      return { type: "rotateView", radians: ROTATE_STEP }
    case "h":
      return { type: "flipView" }
    // The arrows nudge the canvas, for the artist who has no wheel under the
    // hand that is free.
    case "arrowleft":
      return { type: "panView", dx: PAN_STEP, dy: 0 }
    case "arrowright":
      return { type: "panView", dx: -PAN_STEP, dy: 0 }
    case "arrowup":
      return { type: "panView", dx: 0, dy: PAN_STEP }
    case "arrowdown":
      return { type: "panView", dx: 0, dy: -PAN_STEP }
  }
}

/**
 * The radius a size key asks for, given the one in the hand, or nothing.
 *
 * The brackets, because that is where every hand trained on Photoshop,
 * Procreate, Krita or Clip Studio already reaches — a size change is the
 * adjustment made most often, and it should not cost a trip to a panel.
 */
function sizeForKey(key: string, radius: number): number | undefined {
  if (key !== "[" && key !== "]") return
  const next = key === "]" ? radius * SIZE_STEP : radius / SIZE_STEP
  // A step that rounds back to where it started would make the key look dead
  // at the small end, where the multiplicative step is under half a pixel.
  const nudged =
    key === "]" ? Math.max(next, radius + 0.5) : Math.min(next, radius - 0.5)
  const clamped = Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, nudged))
  return clamped === radius ? undefined : clamped
}

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
  documentSize,
  remote,
  palettes,
  brushes,
  openElsewhere = false,
}: {
  documentId?: string
  /** The title shown above the canvas; a document with none is called `DEFAULT_DOCUMENT_NAME`. */
  documentName?: string
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
  /** The cloud-sync backend, when this document has an owned Convex row to sync to. */
  remote?: RemoteIndex
  /** Whether another tab or device currently has this same document open. */
  openElsewhere?: boolean
}) {
  const [engine, setEngine] = useState<Engine | null>(null)
  const [panelsOpen, setPanelsOpen] = useState(true)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [colorOpen, setColorOpen] = useState(false)
  const [brushOpen, setBrushOpen] = useState(false)
  const brushButton = useRef<HTMLButtonElement>(null)
  /** The docked editor's panel, whose strip fitting the view has to avoid. */
  const brushPanel = useRef<HTMLElement>(null)
  /** Whichever of collapse and expand is showing; focus follows the swap. */
  const layersToggle = useRef<HTMLButtonElement>(null)
  const layersToggled = useRef(false)
  const [eraserOpen, setEraserOpen] = useState(false)
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
  const localBrushes = useMemo(() => createLocalBrushStore(), [])
  const brushStore = brushes ?? localBrushes
  const penStore = useMemo(() => createLocalPenSettingsStore(), [])
  const pen = penStore.usePenSettings()
  const library = brushStore.useBrushLibrary(documentId)
  const snapshot = useSyncExternalStore(
    engine?.subscribe ?? subscribeToNothing,
    engine?.getSnapshot ?? getInitialSnapshot,
    getInitialSnapshot
  )

  // React 19 ref cleanup also covers Strict Mode's attach/detach rehearsal.
  const attach = useCallback(
    (canvas: HTMLCanvasElement | null) => {
      if (!canvas) return
      // Kept so the transform box can be laid out over exactly the pixels the
      // engine is presenting into.
      setCanvasElement(canvas)
      const attached = createEngine(canvas, {
        ...(documentWidth !== undefined && documentHeight !== undefined
          ? { documentSize: { width: documentWidth, height: documentHeight } }
          : {}),
        ...(documentId ? { persistence: { documentId } } : {}),
        ...(remote ? { cloud: { remote } } : {}),
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
        attached.dispose()
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
    if (!panel) return 0
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

  useEffect(() => {
    if (!engine) return
    const onKeyDown = (event: KeyboardEvent) => {
      // A layer being renamed owns its own keys, and these are not them. A key
      // a control already handled, such as an arrow on one of the docked
      // brush editor's sliders, must not also pan the canvas.
      if (event.defaultPrevented) return
      const target = event.target as HTMLElement | null
      if (
        target?.isContentEditable ||
        ["INPUT", "TEXTAREA"].includes(target?.tagName ?? "")
      )
        return
      const key = event.key.toLowerCase()
      const accelerated = event.metaKey || event.ctrlKey
      if ((key === "z" || key === "y") && accelerated && !event.altKey) {
        event.preventDefault()
        const redo = key === "y" || event.shiftKey
        void engine.dispatch({ type: redo ? "redo" : "undo" })
        return
      }
      // Navigation is unmodified: the hand that reaches for it is the one not
      // holding the pen, and it should not have to hold a modifier too.
      if (accelerated || event.altKey) return
      // Size before navigation: the brackets belong to the brush, and the
      // radius is read from the engine rather than closed over, so holding the
      // key steps from the size the last press left rather than repeating one.
      const current = engine.getSnapshot()
      const tip = current.tool === "eraser" ? current.eraser : current.brush
      const radius = sizeForKey(key, tip.shape.radius)
      if (radius !== undefined) {
        event.preventDefault()
        void engine.dispatch({
          type: current.tool === "eraser" ? "setEraser" : "setBrush",
          radius,
        })
        return
      }
      const navigation = navigationForKey(key, event.shiftKey)
      if (!navigation) return
      event.preventDefault()
      void engine.dispatch(
        navigation.type === "resetView" || navigation.type === "fitView"
          ? { ...navigation, occludedRight: occludedRight() }
          : navigation
      )
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [engine, occludedRight])

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

  // The eyedropper is a held modifier rather than a tool (D-input), which
  // leaves it with nowhere to announce itself. Tracking the key is what lets
  // the cursor do it: the dropper appears under the hand before the click.
  useEffect(() => {
    const track = (event: KeyboardEvent) => setSampling(event.altKey)
    // A window that loses focus mid-hold never sees the keyup, and a canvas
    // still wearing the dropper would be lying about what a click does.
    const clear = () => setSampling(false)
    window.addEventListener("keydown", track)
    window.addEventListener("keyup", track)
    window.addEventListener("blur", clear)
    return () => {
      window.removeEventListener("keydown", track)
      window.removeEventListener("keyup", track)
      window.removeEventListener("blur", clear)
    }
  }, [])

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
  useEffect(() => {
    // Never before the restore has run: writing on the way in would record
    // the default brush over the one this document was actually left with.
    if (!documentId || !library.loaded || restoredFor.current !== documentId)
      return
    const timer = setTimeout(() => {
      void brushStore
        .recordLastUsed(documentId, currentBrushId, currentRadius)
        .catch(() => {
          // Which brush was in the hand is a convenience, not the painting.
        })
    }, 1_000)
    return () => clearTimeout(timer)
  }, [brushStore, documentId, library.loaded, currentBrushId, currentRadius])

  // The engine starts from the same brush the initial snapshot describes, so
  // the baseline needs no effect to establish: an unsaved session is measured
  // against the default brush, exactly as the engine's own is.
  const saved = savedBrush ?? INITIAL_SNAPSHOT.brush
  const activeTip =
    snapshot.tool === "eraser" ? snapshot.eraser : snapshot.brush
  const brushEdited = isBrushEdited(saved, snapshot.brush)

  const unavailable = snapshot.status === "unavailable"
  const failed = snapshot.status === "failed"
  const viewActions = [
    [
      "Zoom out",
      <MagnifyingGlassMinusIcon key="zoom-out" />,
      () => void engine?.dispatch({ type: "zoomView", factor: 1 / ZOOM_STEP }),
    ],
    [
      "Zoom in",
      <MagnifyingGlassPlusIcon key="zoom-in" />,
      () => void engine?.dispatch({ type: "zoomView", factor: ZOOM_STEP }),
    ],
    [
      "Rotate left",
      <ArrowCounterClockwiseIcon key="rotate-left" />,
      () =>
        void engine?.dispatch({ type: "rotateView", radians: -ROTATE_STEP }),
    ],
    [
      "Rotate right",
      <ArrowClockwiseIcon key="rotate-right" />,
      () => void engine?.dispatch({ type: "rotateView", radians: ROTATE_STEP }),
    ],
    [
      "Flip canvas horizontally",
      <FlipHorizontalIcon key="flip" />,
      () => void engine?.dispatch({ type: "flipView" }),
    ],
    [
      "Fit canvas to window",
      <CornersOutIcon key="fit" />,
      () =>
        void engine?.dispatch({
          type: "fitView",
          occludedRight: occludedRight(),
        }),
    ],
    [
      "Reset view",
      <ArrowsClockwiseIcon key="reset" />,
      () =>
        void engine?.dispatch({
          type: "resetView",
          occludedRight: occludedRight(),
        }),
    ],
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
          if (selected?.kind !== "raster") return
          if (selected.locked)
            toast.info(
              <>
                <strong className="font-semibold">{selected.name}</strong> is
                locked. Unlock it to paint.
              </>,
              { id: "locked-layer" }
            )
          else if (selected.image && !(snapshot.paintingMask && selected.mask))
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
        style={{ cursor: sampling ? SAMPLING_CURSOR : TOOL_CURSOR }}
      />
      {snapshot.status === "ready" && (
        <>
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

          {engine && remote && historyOpen && (
            <VersionPanel
              engine={engine}
              onClose={() => setHistoryOpen(false)}
            />
          )}

          <div className="absolute top-3 left-3 flex gap-1 rounded-xl border border-studio-edge bg-studio-surface/88 p-1.5 shadow-lg backdrop-blur-xl">
            {engine && <ExportDialog engine={engine} />}
            <IconButton
              variant="ghost"
              size="icon"
              label="Undo"
              side="bottom"
              disabled={!snapshot.canUndo}
              onClick={() => void engine?.dispatch({ type: "undo" })}
              className="rounded-lg"
            >
              <ArrowUUpLeftIcon />
            </IconButton>
            <IconButton
              variant="ghost"
              size="icon"
              label="Redo"
              side="bottom"
              disabled={!snapshot.canRedo}
              onClick={() => void engine?.dispatch({ type: "redo" })}
              className="rounded-lg"
            >
              <ArrowUUpRightIcon />
            </IconButton>
          </div>

          <TooltipProvider delayDuration={350}>
            {/* One column holds both rails, so the gap between them stays the
              same however tall the adjustments grow. */}
            <div className="absolute top-[4.375rem] left-3 flex flex-col gap-3">
              <div
                aria-label="Brush adjustments"
                className="flex flex-col items-center gap-1 rounded-xl border border-studio-edge bg-studio-surface/88 p-1.5 shadow-lg backdrop-blur-xl"
              >
                {snapshot.tool === "eraser" ? (
                  <PopoverPrimitive.Root
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
                        side="right"
                        align="end"
                        sideOffset={10}
                        collisionPadding={12}
                        aria-label="Choose an eraser"
                        className="z-50 w-72 rounded-xl border bg-background p-3 shadow-xl"
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
                        <span
                          aria-hidden
                          className="absolute right-1 bottom-1 size-1.5 bg-current opacity-60 [clip-path:polygon(100%_0,100%_100%,0_100%)]"
                        />
                      </IconButton>
                    </PopoverPrimitive.Trigger>
                    <PopoverPrimitive.Portal>
                      <PopoverPrimitive.Content
                        side="right"
                        align="start"
                        sideOffset={10}
                        collisionPadding={12}
                        aria-label="Choose a brush"
                        className="z-50 max-h-[min(36rem,var(--radix-popover-content-available-height))] w-80 max-w-[calc(100vw-24px)] overflow-y-auto rounded-xl border bg-background shadow-xl outline-none"
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
                          />
                        )}
                      </PopoverPrimitive.Content>
                    </PopoverPrimitive.Portal>
                  </PopoverPrimitive.Root>
                )}
                {/* Size and opacity are the two a hand reaches for mid-piece, so
                they stay on the canvas: the editor is for shaping a brush,
                not for the adjustment made between one stroke and the next. */}
                <QuickSetting
                  label="Size"
                  value={`${(activeTip.shape.radius * 2).toFixed(1)} px`}
                  readout={`${Math.round(activeTip.shape.radius * 2)}`}
                  icon={
                    // The dot grows with the brush, up to the icon's own size.
                    <CircleIcon
                      weight="fill"
                      style={{
                        transform: `scale(${Math.min(1, 0.45 + activeTip.shape.radius / 40)})`,
                      }}
                    />
                  }
                >
                  <SliderSetting
                    label="Size"
                    value={activeTip.shape.radius}
                    min={0.5}
                    max={200}
                    step={0.5}
                    scale={2}
                    decimals={1}
                    unit="px"
                    onChange={(radius) =>
                      void engine?.dispatch({
                        type:
                          snapshot.tool === "eraser" ? "setEraser" : "setBrush",
                        radius,
                      })
                    }
                  />
                </QuickSetting>
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
                          snapshot.tool === "eraser" ? "setEraser" : "setBrush",
                        opacity,
                      })
                    }
                  />
                </QuickSetting>
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
                <RailAction
                  label="Brush tool"
                  variant={snapshot.tool === "brush" ? "default" : "ghost"}
                  size="icon"
                  aria-pressed={snapshot.tool === "brush"}
                  onClick={() => {
                    setEraserOpen(false)
                    if (snapshot.tool === "brush")
                      setLibraryOpen((open) => !open)
                    void engine?.dispatch({ type: "setTool", tool: "brush" })
                  }}
                  className="rounded-lg"
                >
                  <BrushIcon id={snapshot.brush.id} />
                </RailAction>
                <RailAction
                  label="Eraser tool"
                  variant={snapshot.tool === "eraser" ? "default" : "ghost"}
                  size="icon"
                  aria-pressed={snapshot.tool === "eraser"}
                  onClick={() => {
                    setLibraryOpen(false)
                    if (snapshot.tool === "eraser")
                      setEraserOpen((open) => !open)
                    void engine?.dispatch({ type: "setTool", tool: "eraser" })
                  }}
                  className="rounded-lg"
                >
                  <EraserToolIcon
                    kind={
                      snapshot.eraser.id === "eraser:pressure"
                        ? "pressure"
                        : "solid"
                    }
                  />
                </RailAction>
                <RailAction
                  label="Colour"
                  variant={colorOpen ? "default" : "ghost"}
                  size="icon"
                  aria-pressed={colorOpen}
                  onClick={() => {
                    setColorOpen((open) => !open)
                  }}
                  className="rounded-lg"
                >
                  <PaletteIcon />
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
                {/* Restore points only exist for a document with a cloud copy
                behind it (§9.4), so an anonymous local document has no ladder
                to offer and is not shown a door to one. */}
                {remote && (
                  <RailAction
                    variant={historyOpen ? "default" : "ghost"}
                    size="icon"
                    label="Version history"
                    aria-pressed={historyOpen}
                    onClick={() => setHistoryOpen((open) => !open)}
                    className="rounded-lg"
                  >
                    <ClockCounterClockwiseIcon />
                  </RailAction>
                )}
              </div>
            </div>
          </TooltipProvider>

          {engine && colorOpen && (
            <aside className="absolute top-16 left-16 z-10 max-h-[calc(100dvh-5rem)] w-72 max-w-[calc(100vw-5rem)] overflow-y-auto rounded-xl border border-studio-edge bg-studio-surface/95 shadow-xl backdrop-blur-xl">
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
                  "pointer-events-auto flex min-h-0 w-full flex-col overflow-y-auto rounded-xl border border-studio-edge bg-studio-surface/88 shadow-xl backdrop-blur-xl",
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
                className="pointer-events-auto flex min-h-0 w-full shrink flex-col overflow-y-auto rounded-xl border border-studio-edge bg-studio-surface/88 shadow-xl backdrop-blur-xl"
              >
                <BrushEditor
                  brush={snapshot.brush}
                  textures={snapshot.textures}
                  edited={brushEdited}
                  onClose={() => {
                    setBrushOpen(false)
                    brushButton.current?.focus()
                  }}
                  onEdit={(next) => void engine.dispatch(brushCommand(next))}
                  onImportTexture={async (file, name) => {
                    const texture = await readTextureFile(file)
                    const id = await brushStore.saveTexture(name, texture)
                    // Registered here as well as by the sync effect, so
                    // the texture is selectable in the editor that
                    // imported it rather than only once the store has
                    // answered.
                    await engine.dispatch({
                      type: "registerTexture",
                      id,
                      texture,
                    })
                    return id
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
                {viewActions.map(([label, icon, action]) => (
                  <Tooltip key={label}>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={label}
                        aria-pressed={
                          label === "Flip canvas horizontally"
                            ? snapshot.view.flipped
                            : undefined
                        }
                        onClick={action}
                        className="rounded-lg"
                      >
                        {icon}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="left" sideOffset={8}>
                      {label}
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>
            </TooltipProvider>
          </div>

          {engine && snapshot.imageTransform && (
            <ImageTransform
              engine={engine}
              snapshot={snapshot}
              canvas={canvasElement}
            />
          )}

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
        </>
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
    </main>
  )
}
