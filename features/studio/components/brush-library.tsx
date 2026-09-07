"use client"

import {
  CopyIcon,
  PencilSimpleIcon,
  FolderPlusIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { Brush } from "@/engine/brush/brush"

import {
  BUILTIN_SET,
  brushShelf,
  duplicateOf,
  type LibraryBrush,
  setForNewBrush,
} from "../lib/brush-shelf"
import type { BrushLibraryState, BrushStore } from "../lib/brush-store"
import { brushDescription } from "../lib/brush-description"
import { BrushIcon } from "./brush-icon"
import { BrushPreview } from "./brush-preview"
import { IconButton } from "./icon-button"

/**
 * The brush library (25): the shelf the artist reaches into, and the only
 * place a brush is kept rather than held.
 *
 * Built-ins and saved brushes are shown as one shelf because they are one
 * thing — both are `Brush` data, and the difference is only where the bytes
 * live. What the panel does with that difference is refuse to offer Delete on
 * a built-in and send Save on one to `duplicateOf` instead: a shipped brush
 * cannot be destroyed, but nothing stops it being taken as a starting point.
 *
 * Storage is injected (`BrushStore`), so this is written once for a signed-in
 * artist and for one who has not signed in yet.
 */
export function BrushLibrary({
  library,
  store,
  brush,
  edited,
  onSelect,
  onClose,
}: {
  library: BrushLibraryState
  store: BrushStore
  /** The working brush: what the pen is painting with right now. */
  brush: Brush
  /** Whether the working brush has moved away from what was last saved. */
  edited: boolean
  onSelect(brush: Brush, keepOpen?: boolean): void
  onClose(): void
}) {
  const [problem, setProblem] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [dragging, setDragging] = useState<LibraryBrush | null>(null)
  /**
   * A set the artist has named but not yet shelved anything in. A set is a
   * name on a brush rather than a row, so an empty one exists only here, in
   * the panel, until something is dragged into it.
   */
  const [pendingSets, setPendingSets] = useState<string[]>([])
  const [newSet, setNewSet] = useState("")

  const shelf = useMemo(() => brushShelf(library.brushes), [library.brushes])
  const sets = useMemo(() => {
    const named = new Set(shelf.map((set) => set.name))
    return [
      ...shelf,
      ...pendingSets
        .filter((name) => !named.has(name))
        .map((name) => ({ name, brushes: [] as LibraryBrush[] })),
    ]
  }, [shelf, pendingSets])

  /**
   * Runs a store change and says so when it fails. Saving a brush is work an
   * artist may have spent an hour on: a silent failure is how it is lost.
   */
  const run = (work: Promise<unknown>) => {
    setProblem(null)
    void work.catch((error: unknown) =>
      setProblem(
        error instanceof Error
          ? error.message
          : "That change could not be saved."
      )
    )
  }

  const selected = library.brushes.find((stored) => stored.id === brush.id)

  const drop = (set: string, index: number) => {
    const moving = dragging
    setDragging(null)
    if (!moving || moving.builtin) return
    run(store.move(moving.id, set, index))
  }

  return (
    <div
      className="flex flex-col gap-3 border-b border-border/70 p-3"
      data-testid="brush-library"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Brushes</h2>
        <IconButton
          variant="ghost"
          size="icon"
          label="Close brush library"
          onClick={onClose}
          className="size-7 rounded-md"
        >
          <XIcon className="size-3.5" />
        </IconButton>
      </div>

      {problem && (
        <p role="alert" className="text-xs text-destructive">
          {problem}
        </p>
      )}

      {!library.loaded && (
        <p className="text-xs text-muted-foreground">Fetching your brushes…</p>
      )}

      {sets.map((set) => (
        <section key={set.name} className="space-y-1.5">
          <h3
            className="text-xs font-medium text-muted-foreground"
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => drop(set.name, set.brushes.length)}
          >
            {set.name}
          </h3>
          {set.brushes.length === 0 && (
            <p className="text-xs text-muted-foreground/70">
              Empty. Drag a brush here.
            </p>
          )}
          {set.brushes.map((entry, index) => (
            <div
              key={entry.id}
              data-testid={`brush-${entry.id}`}
              data-selected={entry.id === brush.id}
              draggable={!entry.builtin}
              onDragStart={() => setDragging(entry)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => drop(set.name, index)}
              className={`flex items-center gap-2 rounded-lg border p-1.5 ${
                entry.id === brush.id ? "border-primary" : "border-border/60"
              }`}
            >
              {/* The same stroke the editor previews, from the same dynamics
                  evaluation: what a brush looks like is how it is chosen. */}
              {renaming === entry.id ? (
                <Input
                  autoFocus
                  defaultValue={entry.name}
                  aria-label={`Name of ${entry.name}`}
                  className="h-7 flex-1 text-xs"
                  onBlur={(event) => {
                    setRenaming(null)
                    run(store.rename(entry.id, event.target.value))
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur()
                    if (event.key === "Escape") setRenaming(null)
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-1 text-left text-xs focus-visible:outline-2 focus-visible:outline-primary"
                  aria-pressed={entry.id === brush.id}
                  aria-label={`Paint with ${entry.name}`}
                  onClick={() => onSelect(entry.brush)}
                >
                  <BrushPreview
                    brush={entry.brush}
                    className="h-10 w-14 shrink-0 rounded-md bg-muted"
                  />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      <BrushIcon
                        id={entry.id}
                        className="mr-1 inline size-3.5"
                      />
                      {entry.name}
                    </span>
                    <span className="mt-1 block text-[10px] leading-snug text-muted-foreground">
                      {brushDescription(entry.id)}
                    </span>
                  </span>
                </button>
              )}
              <IconButton
                variant="ghost"
                size="icon"
                label={`Duplicate ${entry.name}`}
                className="size-7 rounded-md"
                onClick={() => {
                  const copy = duplicateOf(entry, library.brushes)
                  run(
                    store
                      .save(copy.name, copy.set, copy.brush)
                      .then((id) =>
                        onSelect({ ...copy.brush, id, name: copy.name }, true)
                      )
                  )
                }}
              >
                <CopyIcon className="size-3.5" />
              </IconButton>
              {!entry.builtin && (
                <IconButton
                  variant="ghost"
                  size="icon"
                  label={`Rename ${entry.name}`}
                  className="size-7 rounded-md"
                  onClick={() => setRenaming(entry.id)}
                >
                  <PencilSimpleIcon className="size-3.5" />
                </IconButton>
              )}
              {entry.deletable && (
                <IconButton
                  variant="ghost"
                  size="icon"
                  label={`Delete ${entry.name}`}
                  className="size-7 rounded-md"
                  onClick={() => run(store.remove(entry.id))}
                >
                  <TrashIcon className="size-3.5" />
                </IconButton>
              )}
            </div>
          ))}
        </section>
      ))}

      <div className="flex gap-1.5">
        {/* Saving over a brush is offered only where there is a brush to save
            over: a built-in has no row, so the one door out of it is a copy. */}
        {selected && (
          <Button
            size="sm"
            className="flex-1"
            disabled={!edited}
            onClick={() => run(store.update(selected.id, brush))}
          >
            Save
          </Button>
        )}
        <Button
          variant={selected ? "outline" : "default"}
          size="sm"
          className="flex-1"
          onClick={() =>
            run(
              store
                .save(brush.name, setForNewBrush(selected), brush)
                .then((id) => onSelect({ ...brush, id }, true))
            )
          }
        >
          Save as new
        </Button>
      </div>

      <div className="flex gap-1.5">
        <Input
          value={newSet}
          aria-label="New set name"
          placeholder="New set"
          className="h-7 flex-1 text-xs"
          onChange={(event) => setNewSet(event.target.value)}
        />
        <IconButton
          variant="outline"
          size="icon"
          label="Add set"
          className="size-7 rounded-md"
          disabled={!newSet.trim() || newSet.trim() === BUILTIN_SET}
          onClick={() => {
            setPendingSets((existing) => [...existing, newSet.trim()])
            setNewSet("")
          }}
        >
          <FolderPlusIcon className="size-3.5" />
        </IconButton>
      </div>
    </div>
  )
}
