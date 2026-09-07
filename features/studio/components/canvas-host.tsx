"use client"

import {
  ArrowClockwiseIcon,
  ClockCounterClockwiseIcon,
  ArrowCounterClockwiseIcon,
  ArrowUUpLeftIcon,
  ArrowUUpRightIcon,
  CornersOutIcon,
  EraserIcon,
  FlipHorizontalIcon,
  HandIcon,
  LockIcon,
  MagnifyingGlassIcon,
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon,
  PaintBrushIcon,
  PaletteIcon,
  BookmarksSimpleIcon,
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

import { Button } from "@/components/ui/button"
import type { Brush } from "@/engine/brush/brush"
import {
  createEngine,
  type Engine,
  type EngineCommand,
  INITIAL_SNAPSHOT,
  type LayerSummary,
  type RemoteIndex,
  type SyncStatus,
} from "@/engine"

import { ColorPanel } from "@/features/color/components/color-panel"
import { createLocalPaletteStore } from "@/features/color/lib/local-palette-store"
import type { PaletteStore } from "@/features/color/lib/palette-store"

import { brushCommand, isBrushEdited } from "../lib/brush-draft"
import { createLocalBrushStore } from "../lib/local-brush-store"
import type { BrushStore } from "../lib/brush-store"
import { resolveLibraryBrush, setForNewBrush } from "../lib/brush-shelf"
import { DEFAULT_LIBRARY_BRUSH_ID } from "@/engine/brush/presets"
import { readTextureFile } from "../lib/texture-import"
import { BrushEditor } from "./brush-editor"
import { BrushLibrary } from "./brush-library"
import { SliderSetting } from "./slider-setting"
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
  const [libraryOpen, setLibraryOpen] = useState(false)
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
  const documentWidth = documentSize?.width
  const documentHeight = documentSize?.height
  // Created once per host: the store owns the subscription the picker reads
  // through, so a new one each render would resubscribe on every keystroke.
  const localPalettes = useMemo(() => createLocalPaletteStore(), [])
  const paletteStore = palettes ?? localPalettes
  const localBrushes = useMemo(() => createLocalBrushStore(), [])
  const brushStore = brushes ?? localBrushes
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
      void engine.dispatch(navigation)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [engine])

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
  const brushEdited = isBrushEdited(saved, snapshot.brush)

  const unavailable = snapshot.status === "unavailable"
  const failed = snapshot.status === "failed"
  return (
    <main
      className="fixed inset-0 overflow-hidden bg-zinc-900"
      data-engine-status={snapshot.status}
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
      />
      {snapshot.status === "ready" && (
        <>
          <div className="pointer-events-none absolute top-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border bg-background/85 px-4 py-1.5 text-xs shadow-sm backdrop-blur">
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
              className="absolute top-14 left-1/2 max-w-xl -translate-x-1/2 rounded-lg border border-destructive/40 bg-background/95 px-4 py-3 text-sm shadow-lg"
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
          <div className="absolute top-1/2 left-3 flex -translate-y-1/2 flex-col gap-1 rounded-xl border bg-background/88 p-1.5 shadow-lg backdrop-blur-xl">
            <Button
              variant={snapshot.tool === "brush" ? "default" : "ghost"}
              size="icon"
              aria-label="Brush tool"
              aria-pressed={snapshot.tool === "brush"}
              onClick={() =>
                void engine?.dispatch({ type: "setTool", tool: "brush" })
              }
              className="rounded-lg"
            >
              <PaintBrushIcon />
            </Button>
            <Button
              variant={snapshot.tool === "eraser" ? "default" : "ghost"}
              size="icon"
              aria-label="Eraser tool"
              aria-pressed={snapshot.tool === "eraser"}
              onClick={() =>
                void engine?.dispatch({ type: "setTool", tool: "eraser" })
              }
              className="rounded-lg"
            >
              <EraserIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Hand tool"
              className="rounded-lg"
            >
              <HandIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Zoom tool"
              className="rounded-lg"
            >
              <MagnifyingGlassIcon />
            </Button>
            <Button
              variant={colorOpen ? "default" : "ghost"}
              size="icon"
              aria-label="Colour"
              aria-pressed={colorOpen}
              onClick={() => {
                setColorOpen((open) => !open)
                setPanelsOpen(true)
              }}
              className="rounded-lg"
            >
              {/* The rail swatch is the current ink, so the colour in the hand
                  is visible without opening anything. */}
              <PaletteIcon style={{ color: snapshot.color.hex }} />
            </Button>
            <Button
              variant={brushOpen ? "default" : "ghost"}
              size="icon"
              aria-label="Brush editor"
              aria-pressed={brushOpen}
              onClick={() => setBrushOpen((open) => !open)}
              className="rounded-lg"
            >
              <SlidersIcon />
            </Button>
            <Button
              variant={libraryOpen ? "default" : "ghost"}
              size="icon"
              aria-label="Brush library"
              aria-pressed={libraryOpen}
              onClick={() => {
                setLibraryOpen((open) => !open)
                setPanelsOpen(true)
              }}
              className="rounded-lg"
            >
              <BookmarksSimpleIcon />
            </Button>
            {/* Restore points only exist for a document with a cloud copy
                behind it (§9.4), so an anonymous local document has no ladder
                to offer and is not shown a door to one. */}
            {remote && (
              <Button
                variant={historyOpen ? "default" : "ghost"}
                size="icon"
                aria-label="Version history"
                aria-pressed={historyOpen}
                onClick={() => setHistoryOpen((open) => !open)}
                className="rounded-lg"
              >
                <ClockCounterClockwiseIcon />
              </Button>
            )}
          </div>

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

          <div className="absolute top-3 left-3 flex gap-1 rounded-xl border bg-background/88 p-1.5 shadow-lg backdrop-blur-xl">
            {engine && <ExportDialog engine={engine} />}
            <Button
              variant="ghost"
              size="icon"
              aria-label="Undo"
              disabled={!snapshot.canUndo}
              onClick={() => void engine?.dispatch({ type: "undo" })}
              className="rounded-lg"
            >
              <ArrowUUpLeftIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Redo"
              disabled={!snapshot.canRedo}
              onClick={() => void engine?.dispatch({ type: "redo" })}
              className="rounded-lg"
            >
              <ArrowUUpRightIcon />
            </Button>
          </div>

          <div className="absolute bottom-3 left-3 w-56 space-y-2 rounded-xl border bg-background/88 p-3 shadow-lg backdrop-blur-xl">
            {/* Size and opacity are the two a hand reaches for mid-piece, so
                they stay on the canvas: the editor is for shaping a brush,
                not for the adjustment made between one stroke and the next. */}
            <SliderSetting
              label="Size"
              value={snapshot.brush.shape.radius}
              min={0.5}
              max={200}
              step={0.5}
              format={`${(snapshot.brush.shape.radius * 2).toFixed(1)} px`}
              onChange={(radius) =>
                void engine?.dispatch({ type: "setBrush", radius })
              }
            />
            <SliderSetting
              label="Opacity"
              value={snapshot.brush.rendering.opacity}
              min={0}
              max={1}
              step={0.01}
              format={`${Math.round(snapshot.brush.rendering.opacity * 100)}%`}
              onChange={(opacity) =>
                void engine?.dispatch({ type: "setBrush", opacity })
              }
            />
            <SliderSetting
              label="Smoothing"
              value={snapshot.stabilization}
              min={0}
              max={1}
              step={0.01}
              format={`${Math.round(snapshot.stabilization * 100)}%`}
              onChange={(strength) =>
                void engine?.dispatch({ type: "setStabilization", strength })
              }
            />
          </div>

          <div className="absolute bottom-3 left-[15.5rem] flex items-center gap-1 rounded-xl border bg-background/88 p-1.5 shadow-lg backdrop-blur-xl">
            <span
              aria-label="Zoom level"
              aria-live="polite"
              className="w-14 px-1 text-center text-xs text-muted-foreground tabular-nums"
            >
              {Math.round(snapshot.view.zoom * 100)}%
            </span>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Zoom out"
              onClick={() =>
                void engine?.dispatch({
                  type: "zoomView",
                  factor: 1 / ZOOM_STEP,
                })
              }
              className="rounded-lg"
            >
              <MagnifyingGlassMinusIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Zoom in"
              onClick={() =>
                void engine?.dispatch({ type: "zoomView", factor: ZOOM_STEP })
              }
              className="rounded-lg"
            >
              <MagnifyingGlassPlusIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Rotate left"
              onClick={() =>
                void engine?.dispatch({
                  type: "rotateView",
                  radians: -ROTATE_STEP,
                })
              }
              className="rounded-lg"
            >
              <ArrowCounterClockwiseIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Rotate right"
              onClick={() =>
                void engine?.dispatch({
                  type: "rotateView",
                  radians: ROTATE_STEP,
                })
              }
              className="rounded-lg"
            >
              <ArrowClockwiseIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Flip canvas horizontally"
              aria-pressed={snapshot.view.flipped}
              onClick={() => void engine?.dispatch({ type: "flipView" })}
              className="rounded-lg"
            >
              <FlipHorizontalIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Fit to window"
              onClick={() => void engine?.dispatch({ type: "fitView" })}
              className="rounded-lg"
            >
              <CornersOutIcon />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Reset view"
              onClick={() => void engine?.dispatch({ type: "resetView" })}
              className="rounded-lg text-xs"
            >
              Reset
            </Button>
          </div>

          {engine && panelsOpen && (
            <aside className="absolute top-3 right-3 bottom-3 flex w-72 flex-col overflow-y-auto rounded-xl border bg-background/88 shadow-xl backdrop-blur-xl">
              {libraryOpen && (
                <BrushLibrary
                  library={library}
                  store={brushStore}
                  brush={snapshot.brush}
                  edited={brushEdited}
                  onSelect={(next) => {
                    void engine.dispatch(brushCommand(next))
                    setSavedBrush(next)
                  }}
                  onClose={() => setLibraryOpen(false)}
                />
              )}
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
            className={`absolute top-3 rounded-lg bg-background/88 shadow-md backdrop-blur-xl transition-[right] ${
              panelsOpen ? "right-[18.75rem]" : "right-3"
            }`}
          >
            <SidebarSimpleIcon />
          </Button>

          {paintNotice && (
            <div
              role="status"
              className="absolute bottom-5 left-1/2 -translate-x-1/2 rounded-lg border border-brand-gold/40 bg-background/95 px-4 py-2 text-sm shadow-lg"
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
            <h1 className="font-heading text-4xl">
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
