"use client"

import { useState, type ReactNode } from "react"
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
  MAX_SCATTER_OFFSET,
  MAX_SCATTER_SIZE,
  MIN_SCATTER_SIZE,
  MAX_SCATTER_SPACING,
  MIN_SCATTER_SPACING,
  MIN_PRESSURE_CURVE,
  type ArtBrush,
  type ArtBrushKind,
  type PatternParams,
  type ScatterParams,
  type ProfileParams,
  type VectorBrush,
  type VectorBrushKind,
} from "@/engine/brush/vector-brush"
import {
  remakePatternBrush,
  type PatternSource,
} from "@/engine/doc/vector-brush"
import { pathData } from "@/engine/store/export-svg"
import type {
  VectorBrushLibrary as Library,
  VectorBrushStore,
} from "../lib/vector-brush-store"
import { VectorBrushToolIcon } from "./brush-icon"

/** What every kind's editor section is handed. */
type SectionProps = {
  brush: VectorBrush
  change(brush: VectorBrush): void
  /** How the art was assigned from its source shapes; null when it kept none. */
  source: PatternSource | null
  /** The ids of the shapes the art was made from. */
  shapes: readonly string[]
  remake(source: PatternSource): void
}

/**
 * Each kind's editor section and one-line summary; art kinds also say how
 * a fresh brush is made from the selection. A new kind is one entry here.
 */
const KINDS: {
  [K in VectorBrushKind]: {
    label: string
    describe(brush: Extract<VectorBrush, { kind: K }>): string
    Section(props: SectionProps): ReactNode
  }
} = {
  profile: {
    label: "Width profile",
    describe: ({ params }) => {
      if (params.wiggle) return "A line that wanders either side of the spine"
      if (params.tremor > 0.2) return "Blotchy width that swells and pinches"
      if (params.pressure)
        return params.thinning
          ? "Wider when pressed, thinner when fast"
          : "Press harder for a wider line"
      return params.caps === "flat"
        ? "Constant width with square ends"
        : "Constant width at any pressure"
    },
    Section: ({ brush, change }) => (
      <ProfileSection
        params={brush.params}
        pressureOnly={brush.kind === "pattern"}
        change={(params) =>
          change({ ...brush, params: { ...brush.params, ...params } })
        }
      />
    ),
  },
  calligraphy: {
    label: "Calligraphy",
    describe: ({ params }) =>
      params.fixation < 1
        ? "A nib that turns as the pen leans"
        : "A broad nib held at a fixed angle",
    Section: (props) => <CalligraphySection {...props} />,
  },
  pattern: {
    label: "Pattern",
    describe: ({ pattern }) =>
      pattern.mode === "repeat"
        ? "Art repeated along the stroke"
        : "Art stretched along the stroke",
    Section: (props) => <PatternSection {...props} />,
  },
  scatter: {
    label: "Scatter",
    describe: ({ scatter }) =>
      scatter.align
        ? "Art dropped along the stroke, turned with it"
        : "Art dropped along the stroke",
    Section: (props) => <ScatterSection {...props} />,
  },
}

const ART_KINDS = ["pattern", "scatter"] as const satisfies ArtBrushKind[]

/**
 * Whether a brush of kind `editing` shows `section`: an art brush shows the
 * width profile and its own section, ignoring the other kinds'.
 */
const shows = (editing: VectorBrushKind, section: VectorBrushKind) =>
  !(ART_KINDS as readonly VectorBrushKind[]).includes(editing) ||
  section === "profile" ||
  section === editing

/** A one-line summary of what a brush does with the hand. */
const describe = (brush: VectorBrush): string =>
  (KINDS[brush.kind].describe as (brush: VectorBrush) => string)(brush)

export function VectorBrushLibrary({
  library,
  store,
  current,
  select,
  apply,
  canApply,
  makeArt,
  close,
}: {
  library: Library
  store: VectorBrushStore
  current: VectorBrush
  select(brush: VectorBrush): void
  apply(brush: VectorBrush): void
  canApply: boolean
  /** A pattern or scatter brush made of the selected objects; throws when it cannot be. */
  makeArt(kind: ArtBrushKind): ArtBrush
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
                {describe(brush)}
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
        {ART_KINDS.map((kind) => (
          <Button
            key={kind}
            size="sm"
            variant="outline"
            disabled={!canApply}
            onClick={() => {
              try {
                edit(makeArt(kind), null)
              } catch (error) {
                toast.error(
                  error instanceof Error
                    ? error.message
                    : `Could not make a ${kind} brush.`
                )
              }
            }}
          >
            Make {kind} brush
          </Button>
        ))}
      </div>
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setEditing(null)
        }}
      >
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
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
              {Object.entries(KINDS)
                .filter(([kind]) =>
                  shows(editing.kind, kind as VectorBrushKind)
                )
                .map(([kind, { label, Section }]) => (
                  <section
                    key={kind}
                    aria-label={label}
                    className="rounded-lg border p-3"
                  >
                    <h3 className="mb-2 text-sm font-medium">{label}</h3>
                    <Section
                      brush={editing}
                      change={setEditing}
                      source={
                        editing.kind === "pattern"
                          ? (editing.pattern.source?.made ?? null)
                          : null
                      }
                      shapes={
                        editing.kind === "pattern"
                          ? (editing.pattern.source?.shapes.map((s) => s.id) ??
                            [])
                          : []
                      }
                      remake={(next) => {
                        if (editing.kind !== "pattern") return
                        try {
                          setEditing(remakePatternBrush(editing, next))
                        } catch (error) {
                          toast.error(
                            error instanceof Error
                              ? error.message
                              : "Could not remake the pattern brush."
                          )
                        }
                      }}
                    />
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

const SHARES = [
  ["thinning", "Velocity thinning"],
  ["minWidth", "Minimum width"],
  ["smoothing", "Smoothing"],
  ["tremor", "Tremor"],
  ["wiggle", "Wiggle"],
] as const

function ProfileSection({
  params,
  pressureOnly,
  change,
}: {
  params: ProfileParams
  /** A pattern's art keeps its own shape, so only pressure reaches it. */
  pressureOnly: boolean
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
      {!pressureOnly &&
        (["start", "end"] as const).map((end) => (
          <label key={end} className="flex items-center gap-2">
            {end === "start" ? "Start" : "End"} taper (%)
            <PercentInput
              label={`${end === "start" ? "Start" : "End"} profile taper`}
              max={0.5}
              value={params.taper[end]}
              change={(share) =>
                change({ taper: { ...params.taper, [end]: share } })
              }
            />
          </label>
        ))}
      {!pressureOnly && (
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
      )}
      {!pressureOnly &&
        SHARES.map(([key, label]) => (
          <label key={key} className="flex items-center gap-2">
            {label} (%)
            <PercentInput
              label={label}
              value={params[key]}
              change={(share) => change({ [key]: share })}
            />
          </label>
        ))}
    </div>
  )
}

function CalligraphySection({ brush, change }: SectionProps) {
  const { id, name, params } = brush
  const set = (patch: Partial<ProfileParams>) =>
    change({ ...brush, params: { ...params, ...patch } })
  const on = brush.kind === "calligraphy"
  return (
    <div className="grid grid-cols-2 gap-2 text-sm">
      <label className="col-span-2 flex items-center gap-2">
        <input
          type="checkbox"
          checked={on}
          onChange={(event) =>
            change({
              id,
              name,
              params,
              kind: event.target.checked ? "calligraphy" : "profile",
            })
          }
        />
        Draw with a calligraphy nib
      </label>
      <label className="flex items-center gap-2">
        Nib angle (°)
        <Input
          type="number"
          aria-label="Nib angle"
          disabled={!on}
          min={0}
          max={180}
          value={params.nibAngle}
          onChange={(event) => set({ nibAngle: Number(event.target.value) })}
        />
      </label>
      <label className="flex items-center gap-2">
        Nib edge (%)
        <PercentInput
          label="Nib edge"
          disabled={!on}
          value={params.minWidth}
          change={(minWidth) => set({ minWidth })}
        />
      </label>
      <label className="col-span-2 flex items-center gap-2">
        Fixation (%)
        <PercentInput
          label="Nib fixation"
          disabled={!on}
          value={params.fixation}
          change={(fixation) => set({ fixation })}
        />
      </label>
      <p className="col-span-2 text-xs text-muted-foreground">
        Below 100% the nib follows the pen&apos;s tilt; a mouse keeps it at the
        nib angle. Pressure, taper and caps come from the width profile.
      </p>
    </div>
  )
}

const AXES = { horizontal: "Horizontal", vertical: "Vertical" } as const

type Role = "tile" | "start" | "end"

function PatternSection({
  brush,
  change,
  source,
  shapes,
  remake,
}: SectionProps) {
  if (brush.kind !== "pattern")
    return (
      <p className="text-xs text-muted-foreground">
        Select shapes on a vector layer and choose Make pattern brush to lay
        them along your strokes.
      </p>
    )
  const { pattern } = brush
  const set = (patch: Partial<PatternParams>) =>
    change({ ...brush, pattern: { ...pattern, ...patch } })
  const axis = source?.axis ?? "horizontal"
  const drawn = typeof axis === "object" ? axis.drawn : null
  const roleOf = (id: string): Role =>
    source?.start?.includes(id)
      ? "start"
      : source?.end?.includes(id)
        ? "end"
        : "tile"
  const assign = (id: string, role: Role) => {
    const without = (ids?: readonly string[]) =>
      (ids ?? []).filter((other) => other !== id)
    remake({
      ...source,
      start:
        role === "start"
          ? [...without(source?.start), id]
          : without(source?.start),
      end:
        role === "end" ? [...without(source?.end), id] : without(source?.end),
    })
  }
  return (
    <div className="grid grid-cols-2 gap-2 text-sm">
      <PatternPreview pattern={pattern} />
      {source && (
        <>
          <label className="col-span-2 flex items-center gap-2">
            Spine axis
            <select
              aria-label="Pattern axis"
              className="h-8 rounded-md border bg-transparent px-2"
              value={drawn === null ? (axis as string) : `drawn:${drawn}`}
              onChange={(event) => {
                const value = event.target.value
                remake({
                  ...source,
                  axis: value.startsWith("drawn:")
                    ? { drawn: value.slice("drawn:".length) }
                    : (value as keyof typeof AXES),
                })
              }}
            >
              {Object.entries(AXES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
              {shapes.map((id, i) => (
                <option key={id} value={`drawn:${id}`}>
                  Drawn: shape {i + 1}
                </option>
              ))}
            </select>
          </label>
          {shapes.map(
            (id, i) =>
              id !== drawn && (
                <label key={id} className="flex items-center gap-2">
                  Shape {i + 1}
                  <select
                    aria-label={`Shape ${i + 1} role`}
                    className="h-8 rounded-md border bg-transparent px-2"
                    value={roleOf(id)}
                    onChange={(event) => assign(id, event.target.value as Role)}
                  >
                    <option value="tile">Tile</option>
                    <option value="start">Start cap</option>
                    <option value="end">End cap</option>
                  </select>
                </label>
              )
          )}
        </>
      )}
      <label className="flex items-center gap-2">
        Fit
        <select
          aria-label="Pattern fit"
          className="h-8 rounded-md border bg-transparent px-2"
          value={pattern.mode}
          onChange={(event) =>
            set({ mode: event.target.value as PatternParams["mode"] })
          }
        >
          <option value="stretch">Stretch</option>
          <option value="repeat">Repeat</option>
        </select>
      </label>
      <label className="flex items-center gap-2">
        Corners
        <select
          aria-label="Pattern corners"
          className="h-8 rounded-md border bg-transparent px-2"
          value={pattern.corners}
          onChange={(event) =>
            set({ corners: event.target.value as PatternParams["corners"] })
          }
        >
          <option value="bend">Bend</option>
          <option value="split">Split</option>
        </select>
      </label>
      <p className="col-span-2 text-xs text-muted-foreground">
        The art is a stroke width tall. &ldquo;Pressure controls width&rdquo; in
        the width profile scales its thickness.
      </p>
    </div>
  )
}

const SCATTER_SHARES = [
  ["sizeJitter", "Size jitter"],
  ["rotationJitter", "Rotation jitter"],
] as const

function ScatterSection({ brush, change }: SectionProps) {
  if (brush.kind !== "scatter")
    return (
      <p className="text-xs text-muted-foreground">
        Select shapes on a vector layer and choose Make scatter brush to drop
        copies of them along your strokes.
      </p>
    )
  const { scatter } = brush
  const set = (patch: Partial<ScatterParams>) =>
    change({ ...brush, scatter: { ...scatter, ...patch } })
  return (
    <div className="grid grid-cols-2 gap-2 text-sm">
      <label className="flex items-center gap-2">
        Spacing (%)
        <PercentInput
          label="Scatter spacing"
          min={MIN_SCATTER_SPACING}
          max={MAX_SCATTER_SPACING}
          value={scatter.spacing}
          change={(spacing) => set({ spacing })}
        />
      </label>
      <label className="flex items-center gap-2">
        Size (%)
        <PercentInput
          label="Scatter size"
          min={MIN_SCATTER_SIZE}
          max={MAX_SCATTER_SIZE}
          value={scatter.size}
          change={(size) => set({ size })}
        />
      </label>
      {SCATTER_SHARES.map(([key, label]) => (
        <label key={key} className="flex items-center gap-2">
          {label} (%)
          <PercentInput
            label={label}
            value={scatter[key]}
            change={(share) => set({ [key]: share })}
          />
        </label>
      ))}
      <label className="flex items-center gap-2">
        Offset jitter (%)
        <PercentInput
          label="Offset jitter"
          max={MAX_SCATTER_OFFSET}
          value={scatter.offsetJitter}
          change={(offsetJitter) => set({ offsetJitter })}
        />
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={scatter.align}
          onChange={(event) => set({ align: event.target.checked })}
        />
        Align to path
      </label>
      <p className="col-span-2 text-xs text-muted-foreground">
        Spacing, size and offset are shares of the stroke width; rotation jitter
        is a share of a half turn either way. &ldquo;Pressure controls
        width&rdquo; in the width profile scales each copy.
      </p>
    </div>
  )
}

/** A share edited as a whole percentage; `min` and `max` are shares too. */
function PercentInput({
  label,
  value,
  change,
  min = 0,
  max = 1,
  disabled,
}: {
  label: string
  value: number
  change(share: number): void
  min?: number
  max?: number
  disabled?: boolean
}) {
  return (
    <Input
      type="number"
      aria-label={label}
      disabled={disabled}
      min={min * 100}
      max={max * 100}
      value={Math.round(value * 100)}
      onChange={(event) => change(Number(event.target.value) / 100)}
    />
  )
}

/** The art laid out flat: start cap, tile, end cap, a stroke width tall. */
function PatternPreview({ pattern }: { pattern: PatternParams }) {
  const gap = 0.2
  let x = 0
  const pieces = [pattern.start, pattern.tile, pattern.end].flatMap(
    (piece, i) => {
      if (!piece) return []
      const at = x
      x += piece.length + gap
      return [{ piece, at, tile: i === 1 }]
    }
  )
  const width = x - gap
  return (
    <svg
      role="img"
      aria-label="Pattern preview"
      className="col-span-2 h-16 w-full rounded-md border bg-muted/40 text-foreground"
      viewBox={`${-gap} -0.7 ${width + 2 * gap} 1.4`}
      preserveAspectRatio="xMidYMid meet"
    >
      {pieces.map(({ piece, at, tile }) => (
        <g key={at} transform={`translate(${at} 0)`}>
          {tile && (
            <rect
              x={0}
              y={-0.5}
              width={piece.length}
              height={1}
              fill="none"
              stroke="currentColor"
              strokeOpacity={0.25}
              strokeWidth={0.02}
              strokeDasharray="0.06 0.04"
            />
          )}
          <path
            d={piece.paths.map(pathData).join(" ")}
            fill="currentColor"
            fillRule="nonzero"
          />
        </g>
      ))}
    </svg>
  )
}
