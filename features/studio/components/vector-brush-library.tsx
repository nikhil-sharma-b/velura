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
  MAX_PRESSURE_CURVE,
  MIN_PRESSURE_CURVE,
  type ProfileParams,
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
                {describe(brush.params)}
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
                    <ProfileSection
                      params={editing.params}
                      change={(params) =>
                        setEditing({
                          ...editing,
                          params: { ...editing.params, ...params },
                        })
                      }
                    />
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

/** A one-line summary of what a profile brush does with the hand. */
function describe(params: ProfileParams): string {
  if (params.wiggle) return "A line that wanders either side of the spine"
  if (params.tremor > 0.2) return "Blotchy width that swells and pinches"
  if (params.pressure)
    return params.thinning
      ? "Wider when pressed, thinner when fast"
      : "Press harder for a wider line"
  return params.caps === "flat"
    ? "Constant width with square ends"
    : "Constant width at any pressure"
}

const SHARES = [
  ["thinning", "Velocity thinning"],
  ["minWidth", "Minimum width"],
  ["smoothing", "Smoothing"],
  ["tremor", "Tremor"],
  ["wiggle", "Wiggle"],
] as const

function ProfileSection({
  params,
  change,
}: {
  params: ProfileParams
  change(params: Partial<ProfileParams>): void
}) {
  return (
    <div className="grid grid-cols-2 gap-2 text-sm">
      <label className="col-span-2 flex items-center gap-2">
        <input
          type="checkbox"
          checked={params.pressure}
          onChange={(event) => change({ pressure: event.target.checked })}
        />
        Pressure controls width
      </label>
      <label className="flex items-center gap-2">
        Pressure curve
        <Input
          type="number"
          aria-label="Pressure curve"
          min={MIN_PRESSURE_CURVE}
          max={MAX_PRESSURE_CURVE}
          step={0.05}
          value={params.pressureCurve}
          onChange={(event) =>
            change({ pressureCurve: Number(event.target.value) })
          }
        />
      </label>
      {(["start", "end"] as const).map((end) => (
        <label key={end} className="flex items-center gap-2">
          {end === "start" ? "Start" : "End"} taper (%)
          <Input
            type="number"
            aria-label={`${end === "start" ? "Start" : "End"} profile taper`}
            min={0}
            max={50}
            value={params.taper[end] * 100}
            onChange={(event) =>
              change({
                taper: {
                  ...params.taper,
                  [end]: Number(event.target.value) / 100,
                },
              })
            }
          />
        </label>
      ))}
      <label className="flex items-center gap-2">
        Caps
        <select
          aria-label="Profile caps"
          className="h-8 rounded-md border bg-transparent px-2"
          value={params.caps}
          onChange={(event) =>
            change({ caps: event.target.value as ProfileParams["caps"] })
          }
        >
          <option value="style">Shape style</option>
          <option value="round">Round</option>
          <option value="flat">Flat</option>
        </select>
      </label>
      {SHARES.map(([key, label]) => (
        <label key={key} className="flex items-center gap-2">
          {label} (%)
          <Input
            type="number"
            aria-label={label}
            min={0}
            max={100}
            value={Math.round(params[key] * 100)}
            onChange={(event) =>
              change({ [key]: Number(event.target.value) / 100 })
            }
          />
        </label>
      ))}
    </div>
  )
}
