"use client"

import { ClockCounterClockwiseIcon } from "@phosphor-icons/react"
import { useCallback, useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import type { Engine, RestorePoint } from "@/engine"

import { restorePointLabel } from "../lib/restore-point-label"

/**
 * The way back into the document's own past (§9.4).
 *
 * Picking a point *previews* it: the engine applies it as one undoable step,
 * so the artist looks at the real thing at full size rather than at a
 * thumbnail of it, and either keeps it or takes it back. That is why nothing
 * here is destructive and why "Keep" only has to save — the restore has
 * already happened, and undo is still holding everything it covered.
 */
export function VersionPanel({
  engine,
  onClose,
}: {
  engine: Engine
  onClose: () => void
}) {
  const [points, setPoints] = useState<readonly RestorePoint[] | null>(null)
  const [previewing, setPreviewing] = useState<RestorePoint | null>(null)
  const [busy, setBusy] = useState(false)
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
      setBusy(true)
      setProblem(null)
      try {
        // Previewing a second point on top of a first would stack two steps,
        // and one "Cancel" would only take back the newer of them. The
        // preview in hand goes back before the next one is applied, so the
        // artist is only ever one step away from where they started. The
        // engine decides whether that is still possible; a preview painted
        // over is the artist's own work now and is left where it is.
        if (previewing) await engine.revertRestore()
        const restored = await engine.restoreVersion(point.id)
        if (!restored) {
          setPreviewing(null)
          setProblem("That restore point could not be opened. Try another.")
          return
        }
        setPreviewing(point)
      } finally {
        setBusy(false)
      }
    },
    [engine, previewing]
  )

  const cancel = useCallback(async () => {
    setBusy(true)
    try {
      await engine.revertRestore()
      setPreviewing(null)
    } finally {
      setBusy(false)
    }
  }, [engine])

  // Painting during a preview buries the restore under the artist's own
  // work, and one undo would then take back the stroke rather than the
  // preview — silently keeping the restored state they meant to discard. The
  // engine knows whether the restore is still the top step; the panel only
  // has to say so instead of offering a button that would do the wrong thing.
  const canCancel = previewing !== null && engine.canRevertRestore()

  const keep = useCallback(async () => {
    setBusy(true)
    try {
      // Nothing to apply — the pixels are already in the document. This is
      // only about getting them to the cloud without waiting for an idle.
      await engine.save()
      setPreviewing(null)
      onClose()
    } finally {
      setBusy(false)
    }
  }, [engine, onClose])

  return (
    <aside
      aria-label="Version history"
      data-testid="version-panel"
      className="absolute top-3 bottom-3 left-16 flex w-64 flex-col gap-2 rounded-xl border border-studio-edge bg-studio-surface/88 p-3 shadow-lg backdrop-blur-xl"
    >
      <header className="flex items-center gap-2">
        <ClockCounterClockwiseIcon className="size-4" />
        <h2 className="text-sm font-medium">Version history</h2>
      </header>

      {points === null && (
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      )}
      {problem && (
        <p role="alert" className="text-xs text-destructive">
          {problem}
        </p>
      )}
      {points?.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Restore points appear here once this document has been saved to the
          cloud.
        </p>
      )}

      <ul className="-mr-1 flex-1 space-y-1 overflow-y-auto pr-1">
        {points?.map((point) => {
          const active = previewing?.id === point.id
          return (
            <li key={point.id}>
              <Button
                variant={active ? "default" : "ghost"}
                size="sm"
                disabled={busy}
                aria-pressed={active}
                onClick={() => void preview(point)}
                className="w-full justify-start rounded-lg text-xs tabular-nums"
              >
                {restorePointLabel(point.createdAt, now)}
              </Button>
            </li>
          )
        })}
      </ul>

      {previewing ? (
        <div className="space-y-2 rounded-lg border border-studio-edge bg-studio-surface/60 p-2">
          <p className="text-xs text-muted-foreground">
            Previewing {restorePointLabel(previewing.createdAt, now)}.
            {canCancel
              ? " Keeping it leaves one undo step, so this is reversible either way."
              : " You have painted since, so undo now reaches that work first — cancel by undoing back through it."}
          </p>
          <div className="flex gap-1">
            <Button
              size="sm"
              disabled={busy}
              onClick={() => void keep()}
              className="flex-1 rounded-lg"
            >
              Keep
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || !canCancel}
              onClick={() => void cancel()}
              className="flex-1 rounded-lg"
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          onClick={onClose}
          className="rounded-lg"
        >
          Close
        </Button>
      )}
    </aside>
  )
}
