"use client"

import {
  ArrowClockwiseIcon,
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
  SidebarSimpleIcon,
} from "@phosphor-icons/react"
import { useCallback, useEffect, useState, useSyncExternalStore } from "react"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import {
  createEngine,
  type Engine,
  type EngineCommand,
  INITIAL_SNAPSHOT,
  type LayerSummary,
} from "@/engine"

import { LayerPanel } from "./layer-panel"

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

export function CanvasHost() {
  const [engine, setEngine] = useState<Engine | null>(null)
  const [panelsOpen, setPanelsOpen] = useState(true)
  const [paintNotice, setPaintNotice] = useState<string | null>(null)
  const snapshot = useSyncExternalStore(
    engine?.subscribe ?? subscribeToNothing,
    engine?.getSnapshot ?? getInitialSnapshot,
    getInitialSnapshot
  )

  // React 19 ref cleanup also covers Strict Mode's attach/detach rehearsal.
  const attach = useCallback((canvas: HTMLCanvasElement | null) => {
    if (!canvas) return
    const attached = createEngine(canvas)
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
  }, [])

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
          <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded-full border bg-background/85 px-4 py-1.5 text-xs shadow-sm backdrop-blur">
            Untitled artwork
          </div>
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
          </div>

          <div className="absolute top-3 left-3 flex gap-1 rounded-xl border bg-background/88 p-1.5 shadow-lg backdrop-blur-xl">
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
            <div className="flex items-baseline justify-between">
              <Label id="smoothing-label">Smoothing</Label>
              <span className="text-xs text-muted-foreground tabular-nums">
                {Math.round(snapshot.stabilization * 100)}%
              </span>
            </div>
            <Slider
              aria-labelledby="smoothing-label"
              min={0}
              max={100}
              step={1}
              value={[Math.round(snapshot.stabilization * 100)]}
              onValueChange={([percent]) =>
                void engine?.dispatch({
                  type: "setStabilization",
                  strength: percent / 100,
                })
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
            <aside className="absolute top-3 right-3 bottom-3 flex w-72 flex-col overflow-hidden rounded-xl border bg-background/88 shadow-xl backdrop-blur-xl">
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
                  WebGPU is available, but Velura couldn’t start or keep its
                  graphics device running. Close other graphics-heavy tabs and
                  try again. If this continues, restart your browser or update
                  your graphics driver.
                </p>
                <button
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
