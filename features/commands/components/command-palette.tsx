"use client"

import { useEffect, useId, useRef, useState } from "react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

import { usePlatform } from "../hooks/use-keybinds"
import { chordFromEvent, formatChord } from "../lib/chord"
import { paletteEntries, rememberRecent } from "../lib/palette"
import type { Registry } from "../lib/registry"

const RECENT_KEY = "velura.recentCommands"

function readRecent(): string[] {
  try {
    const stored = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]")
    return Array.isArray(stored)
      ? stored.filter((id) => typeof id === "string")
      : []
  } catch {
    return []
  }
}

function writeRecent(recent: readonly string[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent))
  } catch {
    // A private window without storage forgets what ran; nothing else breaks.
  }
}

/**
 * Every command in a registry, searchable by name. The command that opens it
 * is left out — running it from here would only close what is already open —
 * but its chord still closes the palette while the search field has focus,
 * since the window's keybinds leave keys typed into a field alone.
 */
export function CommandPalette<Context>({
  registry,
  context,
  open,
  onOpenChange,
  toggleId,
}: {
  registry: Registry<Context>
  context: Context
  open: boolean
  onOpenChange: (open: boolean) => void
  toggleId: string
}) {
  const platform = usePlatform()
  const listId = useId()
  const search = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(0)
  const [recent, setRecent] = useState<string[]>([])
  // Each opening starts from an empty search, and rereads what ran recently
  // so a run in another tab is picked up too.
  const [wasOpen, setWasOpen] = useState(false)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setQuery("")
      setActive(0)
      setRecent(readRecent())
    }
  }

  /**
   * The dialog stays mounted while it animates out, and the search field would
   * keep focus all that time: the window's keybinds leave a focused field's
   * keys alone, so the first keys after closing would go nowhere. Letting go
   * of focus as it closes hands them back to the canvas at once.
   */
  const setOpen = (next: boolean) => {
    if (!next) search.current?.blur()
    onOpenChange(next)
  }

  /**
   * Reopened before it has finished animating out, the dialog keeps the
   * content it already had and does not focus it again on mounting, so it
   * would sit open with every key going past it. Focusing on each opening
   * covers that as well as the ordinary case.
   */
  useEffect(() => {
    if (open) search.current?.focus()
  }, [open])

  const entries = open
    ? paletteEntries(registry, context, query, recent, [toggleId])
    : []
  const highlighted = Math.min(active, Math.max(0, entries.length - 1))

  const run = (index: number) => {
    const entry = entries[index]
    if (!entry?.available) return
    const next = rememberRecent(recent, entry.command.id)
    setRecent(next)
    writeRecent(next)
    // Closed first, so a command that moves focus or opens a panel of its own
    // is not undone by the dialog handing focus back as it goes.
    setOpen(false)
    entry.command.run(context)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (registry.lookup(chordFromEvent(event))?.id === toggleId) {
      event.preventDefault()
      setOpen(false)
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      const step = event.key === "ArrowDown" ? 1 : -1
      const count = entries.length || 1
      setActive((highlighted + step + count) % count)
    } else if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      // Enter that confirms an IME composition is the input's, not a run.
      event.preventDefault()
      run(highlighted)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        showCloseButton={false}
        className="top-[20%] translate-y-0 gap-0 p-0 sm:max-w-md"
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription className="sr-only">
          Search for a command and press Enter to run it.
        </DialogDescription>
        <input
          ref={search}
          role="combobox"
          aria-label="Search commands"
          aria-expanded
          aria-controls={listId}
          aria-activedescendant={
            entries.length ? `${listId}-${highlighted}` : undefined
          }
          autoComplete="off"
          spellCheck={false}
          placeholder="Search commands…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setActive(0)
          }}
          onKeyDown={onKeyDown}
          className="h-10 w-full border-b border-foreground/10 bg-transparent px-3 text-sm outline-none"
        />
        <ul
          id={listId}
          role="listbox"
          aria-label="Commands"
          className="max-h-80 overflow-y-auto p-1"
        >
          {entries.length === 0 && (
            <li className="px-2 py-3 text-center text-muted-foreground">
              No commands match.
            </li>
          )}
          {entries.map((entry, index) => (
            <li
              key={entry.command.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === highlighted}
              aria-disabled={!entry.available}
              onPointerMove={() => setActive(index)}
              onClick={() => run(index)}
              className={cn(
                "flex cursor-default items-center gap-2 px-2 py-1.5",
                index === highlighted && "bg-accent text-accent-foreground",
                !entry.available && "opacity-50"
              )}
            >
              <span className="flex-1 truncate">{entry.command.label}</span>
              <span className="text-muted-foreground">
                {entry.command.category}
              </span>
              {entry.keybinds[0] !== undefined && (
                <kbd className="font-mono text-[0.65rem] text-muted-foreground">
                  {formatChord(entry.keybinds[0], platform)}
                </kbd>
              )}
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  )
}
