"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import {
  BUILTIN_VECTOR_BRUSHES,
  type VectorBrush,
  type VectorBrushKind,
} from "@/engine/brush/vector-brush"
import type {
  VectorBrushLibrary as Library,
  VectorBrushStore,
} from "../lib/vector-brush-store"
import { VectorBrushToolIcon } from "./brush-icon"

const SECTIONS: Record<VectorBrushKind, string> = {
  profile: "Width profile",
  calligraphy: "Calligraphy",
  pattern: "Pattern",
  scatter: "Scatter",
}

export function VectorBrushLibrary({
  library,
  store,
  current,
  select,
  apply,
  canApply,
  close,
}: {
  library: Library
  store: VectorBrushStore
  current: VectorBrush
  select(brush: VectorBrush): void
  apply(brush: VectorBrush): void
  canApply: boolean
  close(): void
}) {
  const [editing, setEditing] = useState<VectorBrush | null>(null)
  const [sourceId, setSourceId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function work(action: () => Promise<unknown>) {
    setBusy(true)
    try {
      await action()
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not save the vector brush."
      )
    } finally {
      setBusy(false)
    }
  }
  function edit(brush: VectorBrush, id: string | null) {
    setSourceId(id)
    setEditing(structuredClone(brush))
  }
  return (
    <>
      <h2 className="mb-2 text-sm font-medium">Vector brushes</h2>
      {[...BUILTIN_VECTOR_BRUSHES, ...library.brushes].map((brush) => (
        <div key={brush.id} className="mb-1">
          <button
            type="button"
            aria-label={`${brush.name} vector brush`}
            aria-pressed={current.id === brush.id}
            className="flex w-full items-center gap-3 rounded-lg border border-transparent p-3 text-left hover:bg-muted aria-pressed:border-primary aria-pressed:bg-primary/10"
            onClick={() => {
              select(brush)
              close()
            }}
          >
            <VectorBrushToolIcon
              kind={brush.params.pressure ? "pressure" : "solid"}
              className="size-5"
            />
            <span>
              <span className="block text-xs font-medium">
                {brush.name} vector brush
              </span>
              <span className="block text-[10px] text-muted-foreground">
                {brush.params.pressure
                  ? "Press harder for a wider line"
                  : "Constant width at any pressure"}
              </span>
            </span>
          </button>
          {library.brushes.some((b) => b.id === brush.id) && (
            <div className="flex gap-1 px-3">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => edit(brush, brush.id)}
              >
                Edit {brush.name}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => void work(() => store.remove(brush.id))}
              >
                Delete {brush.name}
              </Button>
            </div>
          )}
        </div>
      ))}
      {!library.loaded && (
        <p className="text-xs text-muted-foreground">Loading brushes…</p>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={!canApply}
          onClick={() => {
            apply(current)
            close()
          }}
        >
          Apply brush
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => edit({ ...current, name: "My vector brush" }, null)}
        >
          New brush
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            edit({ ...current, name: `${current.name} copy` }, null)
          }
        >
          Duplicate brush
        </Button>
      </div>
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setEditing(null)
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogTitle>
            {sourceId ? "Edit vector brush" : "Create vector brush"}
          </DialogTitle>
          <DialogDescription>
            Name your brush and choose its width profile.
          </DialogDescription>
          {editing && (
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault()
                void work(async () => {
                  if (sourceId) {
                    await store.update(sourceId, editing)
                    select({ ...editing, id: sourceId })
                  } else {
                    const id = await store.save(editing)
                    select({ ...editing, id })
                  }
                  setEditing(null)
                  close()
                })
              }}
            >
              <label className="block space-y-1 text-sm">
                Brush name
                <Input
                  aria-label="Vector brush name"
                  required
                  maxLength={100}
                  value={editing.name}
                  onChange={(event) =>
                    setEditing({ ...editing, name: event.target.value })
                  }
                />
              </label>
              {Object.entries(SECTIONS).map(([kind, label]) => (
                <section
                  key={kind}
                  aria-label={label}
                  className="rounded-lg border p-3"
                >
                  <h3 className="mb-2 text-sm font-medium">{label}</h3>
                  {kind === "profile" ? (
                    <div className="space-y-2 text-sm">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={editing.params.pressure}
                          onChange={(event) =>
                            setEditing({
                              ...editing,
                              params: {
                                ...editing.params,
                                pressure: event.target.checked,
                              },
                            })
                          }
                        />
                        Pressure controls width
                      </label>
                      {(["start", "end"] as const).map((end) => (
                        <label key={end} className="flex items-center gap-2">
                          {end === "start" ? "Start" : "End"} taper (%)
                          <Input
                            type="number"
                            aria-label={`${end === "start" ? "Start" : "End"} profile taper`}
                            min={0}
                            max={50}
                            value={editing.params.taper[end] * 100}
                            onChange={(event) =>
                              setEditing({
                                ...editing,
                                params: {
                                  ...editing.params,
                                  taper: {
                                    ...editing.params.taper,
                                    [end]: Number(event.target.value) / 100,
                                  },
                                },
                              })
                            }
                          />
                        </label>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      This brush kind will be available in a future update.
                    </p>
                  )}
                </section>
              ))}
              <Button type="submit" disabled={busy}>
                {busy ? "Saving…" : "Save vector brush"}
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
