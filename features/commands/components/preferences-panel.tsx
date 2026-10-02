"use client"

import { XIcon } from "@phosphor-icons/react"
import { useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"

import {
  useBoundRegistry,
  useKeybindOverrides,
  writeKeybindOverrides,
} from "../hooks/use-keybind-overrides"
import { usePlatform } from "../hooks/use-keybinds"
import {
  MODIFIERS,
  chordFromEvent,
  formatChord,
  normaliseKey,
  type Chord,
} from "../lib/chord"
import {
  conflictFor,
  rebind,
  resetCommand,
  unbind,
  type RebindMode,
} from "../lib/overrides"
import type { Command, Registry } from "../lib/registry"
import {
  useRasterMagnification,
  writeRasterMagnification,
} from "@/features/studio/lib/magnification-preference"
import type { RasterMagnification } from "@/engine/view/magnification"

/** The slot being rebound: a new chord, or one in place of `replace`. */
interface Capture {
  id: string
  replace?: Chord
}

/** A captured chord another command already has, waiting on a choice. */
interface Pending extends Capture {
  chord: Chord
  owner: Command<unknown>
}

/**
 * App-wide settings, starting with the keybinds: each command's chords, which
 * can be rebound by pressing the new one, taken off, or put back to the
 * defaults. Only what differs from the defaults is stored.
 */
export function PreferencesPanel<Context>({
  defaults,
  open,
  onOpenChange,
}: {
  defaults: Registry<Context>
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const platform = usePlatform()
  const overrides = useKeybindOverrides()
  const registry = useBoundRegistry(defaults)
  const magnification = useRasterMagnification()
  const [capture, setCapture] = useState<Capture>()
  const [pending, setPending] = useState<Pending>()
  // The modifier pressed alone since capture began, so a key already held
  // when it began cannot be recorded by being let go.
  const lone = useRef<string | undefined>(undefined)

  const format = (chord: Chord) => formatChord(chord, platform)

  const commit = (target: Capture, chord: Chord, mode?: RebindMode) => {
    writeKeybindOverrides(
      rebind(defaults, overrides, target.id, chord, {
        replace: target.replace,
        mode,
      })
    )
    setCapture(undefined)
    setPending(undefined)
  }

  const captured = (chord: Chord) => {
    if (!capture || !chord) return
    const owner = conflictFor(registry, capture.id, chord)
    if (owner) {
      setCapture(undefined)
      setPending({ ...capture, chord, owner: owner as Command<unknown> })
    } else commit(capture, chord)
  }

  // Keys pressed while capturing are the chord being chosen: they must reach
  // neither the window's keybinds nor the dialog, which would close on Escape.
  const onCaptureKeyDown = (event: React.KeyboardEvent) => {
    event.preventDefault()
    event.stopPropagation()
    if (event.repeat) return
    const key = normaliseKey(event.key)
    if (key === "escape" && !event.metaKey && !event.ctrlKey && !event.altKey)
      return setCapture(undefined)
    // A modifier alone is a chord too (hold-to-use), but only once it is let
    // go without another key having joined it.
    if ((MODIFIERS as readonly string[]).includes(key)) {
      lone.current = chordFromEvent(event) === key ? key : undefined
      return
    }
    lone.current = undefined
    captured(chordFromEvent(event))
  }
  const onCaptureKeyUp = (event: React.KeyboardEvent) => {
    event.preventDefault()
    event.stopPropagation()
    const key = normaliseKey(event.key)
    if (lone.current === key) captured(key)
    lone.current = undefined
  }

  const categories = [
    ...new Set(registry.list().map((command) => command.category)),
  ]

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setCapture(undefined)
          setPending(undefined)
        }
        onOpenChange(next)
      }}
    >
      <DialogContent
        // Escape while a key is awaited cancels the capture, not the panel.
        onEscapeKeyDown={(event) => {
          if (!capture) return
          event.preventDefault()
          setCapture(undefined)
        }}
        className="max-h-[85vh] grid-rows-[auto_auto_1fr] sm:max-w-lg"
      >
        <div>
          <DialogTitle>Preferences</DialogTitle>
          <DialogDescription>
            Settings for Velura on this device.
          </DialogDescription>
        </div>
        <section
          aria-labelledby="preferences-canvas"
          className="flex flex-col gap-2"
        >
          <h3 id="preferences-canvas" className="font-medium">
            Canvas
          </h3>
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="preferences-magnification">
              Raster layers when magnified
            </label>
            <Select
              value={magnification}
              onValueChange={(mode) =>
                writeRasterMagnification(mode as RasterMagnification)
              }
            >
              <SelectTrigger id="preferences-magnification">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="pixels">Pixels when zoomed in</SelectItem>
                  <SelectItem value="smooth">Smooth</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        </section>
        <section
          aria-labelledby="preferences-keybinds"
          className="flex min-h-0 flex-col gap-2"
        >
          <div className="flex items-center justify-between">
            <h3 id="preferences-keybinds" className="font-medium">
              Keyboard shortcuts
            </h3>
            <Button
              variant="outline"
              size="xs"
              disabled={Object.keys(overrides).length === 0}
              onClick={() => {
                setCapture(undefined)
                setPending(undefined)
                writeKeybindOverrides({})
              }}
            >
              Reset all
            </Button>
          </div>
          {pending && (
            <div
              role="alert"
              className="flex flex-wrap items-center gap-2 bg-muted p-2"
            >
              <span className="flex-1">
                <Kbd>{format(pending.chord)}</Kbd> is already bound to{" "}
                <strong>{pending.owner.label}</strong>.
              </span>
              {pending.replace !== undefined && (
                <Button
                  size="xs"
                  onClick={() => commit(pending, pending.chord, "swap")}
                >
                  Swap
                </Button>
              )}
              <Button
                size="xs"
                onClick={() => commit(pending, pending.chord, "reassign")}
              >
                Reassign
              </Button>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => setPending(undefined)}
              >
                Cancel
              </Button>
            </div>
          )}
          <div className="min-h-0 overflow-y-auto">
            {categories.map((category) => (
              <div key={category} className="mb-3">
                <h4 className="mb-1 text-muted-foreground">{category}</h4>
                <ul>
                  {registry
                    .list()
                    .filter((command) => command.category === category)
                    .map((command) => {
                      const chords = registry.keybinds(command.id)
                      const capturing = (replace?: Chord) =>
                        capture?.id === command.id &&
                        capture.replace === replace
                      const captureButton = () => (
                        <button
                          autoFocus
                          aria-label={`Press a key for ${command.label}`}
                          onKeyDown={onCaptureKeyDown}
                          onKeyUp={onCaptureKeyUp}
                          onBlur={() => setCapture(undefined)}
                          className="h-6 bg-accent px-2 font-mono text-accent-foreground"
                        >
                          Press a key…
                        </button>
                      )
                      return (
                        <li
                          key={command.id}
                          data-command={command.id}
                          className="flex min-h-8 flex-wrap items-center gap-1 py-0.5"
                        >
                          <span className="flex-1 truncate">
                            {command.label}
                          </span>
                          {chords.map((chord) =>
                            capturing(chord) ? (
                              <span key={chord}>{captureButton()}</span>
                            ) : (
                              <span key={chord} className="flex items-center">
                                <button
                                  aria-label={`Change ${format(chord)} for ${command.label}`}
                                  onClick={() => {
                                    setPending(undefined)
                                    setCapture({
                                      id: command.id,
                                      replace: chord,
                                    })
                                  }}
                                  className="h-6 bg-muted px-2 font-mono hover:bg-accent"
                                >
                                  {format(chord)}
                                </button>
                                <Button
                                  variant="ghost"
                                  size="icon-xs"
                                  aria-label={`Remove ${format(chord)} from ${command.label}`}
                                  onClick={() =>
                                    writeKeybindOverrides(
                                      unbind(
                                        defaults,
                                        overrides,
                                        command.id,
                                        chord
                                      )
                                    )
                                  }
                                >
                                  <XIcon />
                                </Button>
                              </span>
                            )
                          )}
                          {capturing() ? (
                            captureButton()
                          ) : (
                            <Button
                              variant="ghost"
                              size="xs"
                              aria-label={`Add a shortcut for ${command.label}`}
                              onClick={() => {
                                setPending(undefined)
                                setCapture({ id: command.id })
                              }}
                            >
                              Add
                            </Button>
                          )}
                          {command.id in overrides && (
                            <Button
                              variant="ghost"
                              size="xs"
                              aria-label={`Reset ${command.label}`}
                              onClick={() =>
                                writeKeybindOverrides(
                                  resetCommand(defaults, overrides, command.id)
                                )
                              }
                            >
                              Reset
                            </Button>
                          )}
                        </li>
                      )
                    })}
                </ul>
              </div>
            ))}
          </div>
        </section>
      </DialogContent>
    </Dialog>
  )
}
