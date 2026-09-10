"use client"

import {
  ArrowClockwiseIcon,
  ArrowsClockwiseIcon,
  ClockCounterClockwiseIcon,
  ArrowCounterClockwiseIcon,
  ArrowUUpLeftIcon,
  ArrowUUpRightIcon,
  CornersOutIcon,
  CaretDownIcon,
  FlipHorizontalIcon,
  LockIcon,
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon,
  PaletteIcon,
  SlidersIcon,
  SidebarSimpleIcon,
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
import { Button } from "@/components/ui/button"
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
import { DEFAULT_LIBRARY_BRUSH_ID } from "@/engine/brush/presets"
import {
  dragCarriesFile,
  firstImageFile,
  placeImageFile,
} from "../lib/image-import"
import { readTextureFile } from "../lib/texture-import"
import { BrushEditor } from "./brush-editor"
import { TOOL_CURSOR } from "../lib/tool-cursor"
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

function RailAction({
  side = "right",
  ...props
}: ComponentProps<typeof IconButton>) {
  return <IconButton {...props} side={side} className="rounded-lg" />
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
      // Fit is the overview; with shift it is the way back to square.
      return shift ? { type: "resetView" } : { type: "fitView" }
    case "[":
      return { type: "rotateView", radians: -ROTATE_STEP }
    case "]":
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
  documentSize,
  remote,
  palettes,
  brushes,
  openElsewhere = false,
}: {
  documentId?: string
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
  const [paintNotice, setPaintNotice] = useState<string | null>(null)
  /** Why the last dropped or pasted image did not come in, if it did not. */
  const [imageProblem, setImageProblem] = useState<string | null>(null)
  /** An image is over the canvas and would land if let go of. */
  const [imageOverCanvas, setImageOverCanvas] = useState(false)
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

  useEffect(() => {
    if (!engine) return
    const onKeyDown = (event: KeyboardEvent) => {
      // A layer being renamed owns its own keys, and these are not them.
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
      const navigation = navigationForKey(key, event.shiftKey)
      if (!navigation) return
      event.preventDefault()
      void engine.dispatch(
        navigation.type === "resetView" && !panelsOpen
          ? { ...navigation, panX: 0 }
          : navigation
      )
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [engine, panelsOpen])

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
      () => void engine?.dispatch({ type: "fitView" }),
    ],
    [
      "Reset view",
      <ArrowsClockwiseIcon key="reset" />,
      () =>
        void engine?.dispatch({
          type: "resetView",
          ...(panelsOpen ? {} : { panX: 0 }),
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
        onPointerDown={() => {
          const selected = findLayer(snapshot.layers, snapshot.activeLayerId)
          if (selected?.kind === "raster" && selected.locked)
            setPaintNotice(`${selected.name} is locked. Unlock it to paint.`)
        }}
        // Touch and pen gestures belong to the stroke, not to the scroller.
        className="block h-full w-full touch-none"
        // A dot under the hand, so the mark has a visible starting point.
        style={{ cursor: TOOL_CURSOR }}
      />
      {snapshot.status === "ready" && (
        <>
          <div className="pointer-events-none absolute top-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-studio-edge bg-studio-surface/85 px-4 py-1.5 text-xs shadow-sm backdrop-blur">
            <span>Untitled artwork</span>
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
          <TooltipProvider delayDuration={350}>
            <div className="absolute top-1/2 left-3 flex -translate-y-1/2 flex-col items-center gap-1 rounded-xl border border-studio-edge bg-studio-surface/88 p-1.5 shadow-lg backdrop-blur-xl">
              <RailAction
                label="Brush tool"
                variant={snapshot.tool === "brush" ? "default" : "ghost"}
                size="icon"
                aria-pressed={snapshot.tool === "brush"}
                onClick={() => {
                  setEraserOpen(false)
                  if (snapshot.tool === "brush") setLibraryOpen((open) => !open)
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
                  if (snapshot.tool === "eraser") setEraserOpen((open) => !open)
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
                  setPanelsOpen(true)
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
          </TooltipProvider>

          {engine && (
            <BrushEditor
              open={brushOpen}
              brush={snapshot.brush}
              textures={snapshot.textures}
              edited={brushEdited}
              onOpenChange={setBrushOpen}
              onEdit={(next) => void engine.dispatch(brushCommand(next))}
              onImportTexture={async (file, name) => {
                const texture = await readTextureFile(file)
                const id = await brushStore.saveTexture(name, texture)
                // Registered here as well as by the sync effect, so the
                // texture is selectable in the dialog that imported it rather
                // than only once the store has answered.
                await engine.dispatch({ type: "registerTexture", id, texture })
                return id
              }}
              problem={brushProblem}
              onSave={() => {
                const working = snapshot.brush
                const stored = library.brushes.find(
                  (brush) => brush.id === working.id
                )
                setBrushProblem(null)
                // A built-in has no row to write over, so saving an edit to
                // one keeps it and creates the artist's own brush beside it —
                // which is what makes a shipped brush a starting point rather
                // than a dead end.
                const write: Promise<Brush> = stored
                  ? brushStore.update(stored.id, working).then(() => working)
                  : brushStore
                      .save(working.name, setForNewBrush(stored), working)
                      .then(async (id) => {
                        // The brush in the hand becomes the brush that was
                        // saved, id and all: without that, the editor would go
                        // on measuring it against something it no longer is
                        // and call a saved brush unsaved.
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
            <div
              className={`absolute bottom-3 w-56 space-y-2 rounded-xl border border-studio-edge bg-studio-surface/88 p-3 shadow-lg backdrop-blur-xl ${panelsOpen ? "right-[19.5rem]" : "right-3"}`}
            >
              {snapshot.tool === "eraser" ? (
                <PopoverPrimitive.Root
                  open={eraserOpen}
                  onOpenChange={setEraserOpen}
                >
                  <PopoverPrimitive.Trigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Choose eraser: ${snapshot.eraser.name}`}
                      className="h-8 w-full justify-between px-1 text-xs"
                    >
                      <span className="flex items-center gap-2">
                        <EraserToolIcon
                          kind={
                            snapshot.eraser.id === "eraser:pressure"
                              ? "pressure"
                              : "solid"
                          }
                        />
                        {snapshot.eraser.name}
                      </span>
                      <CaretDownIcon />
                    </Button>
                  </PopoverPrimitive.Trigger>
                  <PopoverPrimitive.Portal>
                    <PopoverPrimitive.Content
                      side="top"
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
                          aria-pressed={snapshot.eraser.id === `eraser:${kind}`}
                          className="mb-1 flex w-full items-center gap-3 rounded-lg border border-transparent p-3 text-left hover:bg-muted aria-pressed:border-primary aria-pressed:bg-primary/10"
                          onClick={() => {
                            void engine?.dispatch({ type: "setEraser", kind })
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
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Choose brush: ${snapshot.brush.name}`}
                      className="h-8 w-full justify-between px-1 text-xs"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <BrushIcon
                          id={snapshot.brush.id}
                          className="shrink-0"
                        />
                        <span className="truncate">{snapshot.brush.name}</span>
                      </span>
                      <CaretDownIcon className="shrink-0" />
                    </Button>
                  </PopoverPrimitive.Trigger>
                  <PopoverPrimitive.Portal>
                    <PopoverPrimitive.Content
                      side="top"
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
                    type: snapshot.tool === "eraser" ? "setEraser" : "setBrush",
                    radius,
                  })
                }
              />
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
                    type: snapshot.tool === "eraser" ? "setEraser" : "setBrush",
                    opacity,
                  })
                }
              />
              <SliderSetting
                label="Smoothing"
                value={snapshot.stabilization}
                min={0}
                max={1}
                step={0.01}
                scale={100}
                unit="%"
                onChange={(strength) =>
                  void engine?.dispatch({ type: "setStabilization", strength })
                }
              />
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
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Pen settings"
                    className="h-8 w-full justify-between px-1 text-xs"
                  >
                    <span className="text-muted-foreground">Pen</span>
                    <CaretDownIcon className="shrink-0" />
                  </Button>
                </PopoverPrimitive.Trigger>
                <PopoverPrimitive.Portal>
                  <PopoverPrimitive.Content
                    side="top"
                    align="start"
                    sideOffset={10}
                    collisionPadding={12}
                    aria-label="Pen settings"
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

            <div
              aria-label="View controls"
              className={`absolute top-1/2 flex -translate-y-1/2 flex-col items-center gap-1 rounded-xl border border-studio-edge bg-studio-surface/88 p-1.5 shadow-lg backdrop-blur-xl ${panelsOpen ? "right-[19.5rem]" : "right-3"}`}
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

          {engine && panelsOpen && (
            <aside className="absolute top-3 right-3 bottom-3 flex w-72 flex-col overflow-y-auto rounded-xl border border-studio-edge bg-studio-surface/88 shadow-xl backdrop-blur-xl">
              {colorOpen && (
                <ColorPanel
                  engine={engine}
                  snapshot={snapshot}
                  store={paletteStore}
                  onClose={() => setColorOpen(false)}
                />
              )}
              <LayerPanel engine={engine} snapshot={snapshot} />
            </aside>
          )}
          <Button
            variant="outline"
            size="icon"
            aria-label={panelsOpen ? "Collapse panels" : "Expand panels"}
            onClick={() => setPanelsOpen((open) => !open)}
            className={`absolute top-3 rounded-lg border border-studio-edge bg-studio-surface/88 shadow-md backdrop-blur-xl transition-[right] ${
              panelsOpen ? "right-[19.5rem]" : "right-3"
            }`}
          >
            <SidebarSimpleIcon />
          </Button>

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

          {paintNotice && (
            <div
              role="status"
              className="absolute bottom-5 left-1/2 -translate-x-1/2 rounded-lg border border-brand-gold/40 bg-studio-surface/95 px-4 py-2 text-sm shadow-lg"
            >
              <LockIcon className="mr-2 inline size-4 text-brand-gold" />
              {paintNotice}
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
