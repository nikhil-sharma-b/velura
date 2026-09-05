"use client"

import { useCallback, useState, useSyncExternalStore } from "react"
import {
  createEngine,
  DEFAULT_STABILIZATION,
  type Engine,
  type EngineSnapshot,
} from "@/engine"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"

const initialSnapshot: EngineSnapshot = Object.freeze({
  status: "idle",
  width: 1,
  height: 1,
  outputColorSpace: "srgb",
  stabilization: DEFAULT_STABILIZATION,
  error: null,
})
const getInitialSnapshot = () => initialSnapshot
const subscribeToNothing = () => () => {}

export function CanvasHost() {
  const [engine, setEngine] = useState<Engine | null>(null)
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
        // Touch and pen gestures belong to the stroke, not to the scroller.
        className="block h-full w-full touch-none"
      />
      {snapshot.status === "ready" && (
        <div className="absolute bottom-6 left-6 w-56 space-y-2 rounded-lg border bg-background/80 p-4 backdrop-blur">
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
