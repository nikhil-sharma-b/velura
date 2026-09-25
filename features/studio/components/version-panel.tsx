"use client"

import { XIcon } from "@phosphor-icons/react"
import { useCallback, useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import type { Engine, RestorePoint } from "@/engine"
import { cn } from "@/lib/utils"

import {
  groupRestorePointsByDay,
  restorePointAge,
  restorePointLabel,
  restorePointTimes,
} from "../lib/restore-point-label"
import { IconButton } from "./icon-button"

/** What the host needs to know to close the panel safely. */
export type VersionPreviewState = {
  /** A version is being opened or taken back; closing now would race it. */
  busy: boolean
  /** A version is on the canvas on trial, not yet restored. */
  onTrial: boolean
}

/**
 * The way back into the document's own past (§9.4), drawn as the timeline it
 * is: the canvas as it is now at the top, then every restore point under the
 * day it was made.
 *
 * Picking a point *previews* it: the engine applies it as one undoable step,
 * so the artist looks at the real thing at full size rather than at a
 * thumbnail of it, and either keeps it or takes it back. That is why nothing
 * here is destructive and why restoring only has to save — the restore has
 * already happened, and undo is still holding everything it covered.
 */
export function VersionPanel({
  engine,
  onClose,
  onPreviewStateChange,
  locked = false,
  className,
}: {
  engine: Engine
  /**
   * The host closes the panel, and owns going back to now as it does (see
   * `onPreviewStateChange`): it is the one party present for every way the
   * panel can go, leaving the canvas included.
   */
  onClose: () => void
  /**
   * Told synchronously, in the same call that changes it, so a host acting on
   * a close that follows at once — "Restore this version" ends the trial and
   * then closes — never reads the state from before it.
   */
  onPreviewStateChange?: (state: VersionPreviewState) => void
  /**
   * The host is busy with the preview itself — taking one back as it closes
   * — so nothing here may start another step until it has landed.
   */
  locked?: boolean
  /** Where the host places it; the panel draws its own pointer at top left. */
  className?: string
}) {
  const [points, setPoints] = useState<readonly RestorePoint[] | null>(null)
  const [previewing, setPreviewingState] = useState<RestorePoint | null>(null)
  const [busy, setBusyState] = useState(false)
  const state = useRef<VersionPreviewState>({ busy: false, onTrial: false })
  const report = useRef(onPreviewStateChange)
  useEffect(() => {
    report.current = onPreviewStateChange
  })
  const setPreviewing = useCallback((point: RestorePoint | null) => {
    state.current = { ...state.current, onTrial: point !== null }
    report.current?.(state.current)
    setPreviewingState(point)
  }, [])
  const setBusy = useCallback((busy: boolean) => {
    state.current = { ...state.current, busy }
    report.current?.(state.current)
    setBusyState(busy)
  }, [])
  const [problem, setProblem] = useState<string | null>(null)
  // Read once when the panel opens: labels are relative to "now", and a
  // clock re-read on every render would let a point silently change its name
  // mid-session while the artist is looking at it.
  const [now] = useState(() => Date.now())

  useEffect(() => {
    let live = true
    void engine.restorePoints().then((found) => {
      if (live) setPoints(found)
    })
    return () => {
      live = false
    }
  }, [engine])

  const preview = useCallback(
    async (point: RestorePoint) => {
      if (previewing?.id === point.id) return
      setBusy(true)
      setProblem(null)
      try {
        // Previewing a second point on top of a first would stack two steps,
        // and one "Back to now" would only take back the newer of them. The
        // preview in hand goes back before the next one is applied, so the
        // artist is only ever one step away from where they started. The
        // engine decides whether that is still possible; a preview painted
        // over is the artist's own work now and is left where it is.
        if (previewing) await engine.revertRestore()
        const restored = await engine.restoreVersion(point.id)
        if (!restored) {
          setPreviewing(null)
          setProblem("That version could not be opened. Try another one.")
          return
        }
        setPreviewing(point)
      } finally {
        setBusy(false)
      }
    },
    [engine, previewing, setBusy, setPreviewing]
  )

  // Painting during a preview buries the restore under the artist's own
  // work, and one undo would then take back the stroke rather than the
  // preview — silently keeping the restored state they meant to discard. The
  // engine knows whether the restore is still the top step; the panel only
  // has to say so instead of offering a button that would do the wrong thing.
  const canGoBack = previewing !== null && engine.canRevertRestore()

  const backToNow = useCallback(async () => {
    setBusy(true)
    try {
      await engine.revertRestore()
      setPreviewing(null)
    } finally {
      setBusy(false)
    }
  }, [engine, setBusy, setPreviewing])

  const restore = useCallback(async () => {
    setBusy(true)
    try {
      // Nothing to apply — the pixels are already on the canvas. Until now
      // they were only on trial and saved nowhere; keeping them saves them,
      // here and to the cloud, without waiting for an idle.
      const { synced } = await engine.keepRestore()
      setPreviewing(null)
      if (!synced) {
        // Kept, and safe on this device; the next sync takes it the rest of
        // the way. Said here rather than closed on, so it is not missed.
        setProblem(
          "Restored on this device. It will reach your other devices once the connection is back."
        )
        return
      }
    } catch {
      // Still on the canvas and still on trial, so nothing is lost: say so
      // and leave the choice with the artist rather than closing on it.
      setProblem("That version could not be saved. Try restoring it again.")
      return
    } finally {
      setBusy(false)
    }
    // After the panel stops reporting itself busy: the host will not close a
    // panel that is still mid-step, and this one no longer is.
    onClose()
  }, [engine, onClose, setBusy, setPreviewing])

  const groups = points ? groupRestorePointsByDay(points, now) : []
  const inert = busy || locked

  return (
    <aside
      aria-label="Version history"
      data-testid="version-panel"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || inert) return
        event.stopPropagation()
        onClose()
      }}
      className={cn(
        "z-10 flex max-h-[calc(100dvh-6rem)] w-72 max-w-[calc(100vw-11rem)] flex-col rounded-xl border border-studio-edge bg-studio-surface shadow-xl",
        className
      )}
    >
      {/* Points up at the toolbar button, so the panel reads as opened by it
          rather than as something that appeared elsewhere. */}
      <span
        aria-hidden
        className="absolute -top-1.5 left-3 size-3 rotate-45 border-t border-l border-studio-edge bg-studio-surface"
      />
      <header className="flex items-center justify-between border-b border-studio-edge/70 py-2 pr-2 pl-3">
        <h2 className="text-sm font-medium">Version history</h2>
        <IconButton
          variant="ghost"
          size="icon"
          label="Close version history"
          disabled={inert}
          onClick={onClose}
          className="size-7 rounded-md"
        >
          <XIcon className="size-3.5" />
        </IconButton>
      </header>

      <div className="overflow-y-auto p-2">
        {problem && (
          <p role="alert" className="px-2 pt-1 pb-2 text-xs text-destructive">
            {problem}
          </p>
        )}

        {/* The rail runs behind every node, so the points read as one line
            through time rather than as a list of unrelated buttons. */}
        <ol className="relative before:absolute before:top-4 before:bottom-4 before:left-3.5 before:w-px before:bg-studio-edge">
          <li>
            <button
              type="button"
              disabled={!canGoBack || inert}
              onClick={() => void backToNow()}
              className="group relative flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring enabled:hover:bg-foreground/5 disabled:cursor-default"
            >
              <Node
                state={previewing ? "left" : "current"}
                className="mt-[3px]"
              />
              <span className="flex min-w-0 flex-col">
                <span className="text-sm font-medium">Now</span>
                <span className="text-xs text-muted-foreground">
                  {previewing
                    ? canGoBack
                      ? "Go back to your canvas as you left it"
                      : "Includes what you painted over the version"
                    : "Your canvas as it is"}
                </span>
              </span>
            </button>
          </li>

          {points === null && (
            <li className="flex items-center gap-3 px-2 py-3 text-xs text-muted-foreground">
              <Spinner className="ml-0.5 size-3.5" />
              Looking for earlier versions
            </li>
          )}

          {points?.length === 0 && (
            <li className="py-3 pr-2 pl-9 text-xs text-muted-foreground">
              No earlier versions yet. One is kept each time this document syncs
              to the cloud.
            </li>
          )}

          {groups.map((group) => {
            const times = restorePointTimes(group.points)
            return (
              <li key={group.day}>
                <p className="pt-3 pr-2 pb-1 pl-9 text-xs text-muted-foreground">
                  {group.day}
                </p>
                <ol>
                  {group.points.map((point) => {
                    const active = previewing?.id === point.id
                    const age = restorePointAge(point.createdAt, now)
                    return (
                      <li key={point.id}>
                        <button
                          type="button"
                          disabled={inert}
                          aria-pressed={active}
                          aria-label={`Preview ${restorePointLabel(point.createdAt, now)}`}
                          onClick={() => void preview(point)}
                          className={cn(
                            "relative flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-100",
                            active
                              ? "bg-primary/15"
                              : "enabled:hover:bg-foreground/5"
                          )}
                        >
                          <Node state={active ? "previewing" : "past"} />
                          <span className="text-sm tabular-nums">
                            {times.get(point.id)}
                          </span>
                          {age && (
                            <span className="text-xs text-muted-foreground">
                              {age}
                            </span>
                          )}
                          {active && busy && (
                            <Spinner className="ml-auto size-3.5" />
                          )}
                        </button>

                        {active && (
                          <div className="animate-in space-y-2.5 pt-1.5 pr-2 pb-3 pl-9 duration-200 fade-in-0 slide-in-from-top-1 motion-reduce:animate-none">
                            <p className="text-xs text-muted-foreground">
                              {canGoBack
                                ? "This version is on your canvas now. Restore it to keep it, or go back to where you were."
                                : "You painted on top of this version, so it is part of your canvas now. Undo steps back through that painting."}
                            </p>
                            <div className="flex gap-1.5">
                              <Button
                                size="sm"
                                disabled={inert}
                                onClick={() => void restore()}
                                className="rounded-lg"
                              >
                                {canGoBack ? "Restore this version" : "Done"}
                              </Button>
                              {canGoBack && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  disabled={inert}
                                  onClick={() => void backToNow()}
                                  className="rounded-lg"
                                >
                                  Back to now
                                </Button>
                              )}
                            </div>
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ol>
              </li>
            )
          })}
        </ol>
      </div>
    </aside>
  )
}

/**
 * A point on the rail. "Now" is solid while the canvas shows it and hollow
 * once a preview has taken its place, so the timeline says which moment is
 * on screen without a word of copy.
 */
function Node({
  state,
  className,
}: {
  state: "current" | "left" | "past" | "previewing"
  className?: string
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative z-10 size-3.5 shrink-0 rounded-full border-2 bg-studio-surface transition-colors",
        state === "current" && "border-primary bg-primary",
        state === "left" && "border-primary",
        state === "past" && "mx-0.5 size-2.5 border-muted-foreground/60",
        state === "previewing" &&
          "border-primary bg-primary ring-4 ring-primary/25",
        className
      )}
    />
  )
}
