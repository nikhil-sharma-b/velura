"use client"

import { PlusIcon, TrashIcon, XIcon } from "@phosphor-icons/react"
import { useMemo, useState, useSyncExternalStore } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import {
  clampChromaToSrgb,
  maxSrgbChroma,
  type Oklch,
  oklchToWorking,
  parseHex,
  workingToHex,
  workingToOklch,
  hexToWorking,
} from "@/engine/color/oklch"
import type { Engine, EngineSnapshot } from "@/engine"

import type { PaletteRecord, PaletteStore } from "../lib/palette-store"

/**
 * How the artist holds a colour while choosing it: lightness and hue as OKLCH
 * gives them, and saturation as a *fraction* of the chroma this lightness and
 * hue can actually hold. The fraction is what is kept in state rather than the
 * chroma itself, so dragging lightness or hue keeps a colour as saturated as
 * it was instead of quietly desaturating it against a ceiling that moved.
 */
type Choice = { lightness: number; saturation: number; hue: number }

function toOklch({ lightness, saturation, hue }: Choice): Oklch {
  return { lightness, chroma: saturation * maxSrgbChroma(lightness, hue), hue }
}

function toChoice(color: Oklch): Choice {
  const ceiling = maxSrgbChroma(color.lightness, color.hue)
  return {
    lightness: color.lightness,
    saturation: ceiling > 0 ? Math.min(1, color.chroma / ceiling) : 0,
    hue: color.hue,
  }
}

function choiceFromHex(hex: string): Choice {
  return toChoice(clampChromaToSrgb(workingToOklch(hexToWorking(hex))))
}

function hexFor(choice: Choice): string {
  return workingToHex(oklchToWorking(toOklch(choice)))
}

/**
 * A CSS gradient sampled along one axis, in the colours it is choosing
 * between, with the other two axes held where they are. Only the held axes are
 * passed, so a gradient is rebuilt only when something it actually shows has
 * moved — which matters, because each stop costs a gamut search.
 */
function ramp(axis: keyof Choice, held: Partial<Choice>, stops = 12): string {
  const range = axis === "hue" ? 360 : 1
  const colors = Array.from({ length: stops + 1 }, (_, step) =>
    hexFor({
      lightness: 0,
      saturation: 0,
      hue: 0,
      ...held,
      [axis]: (step / stops) * range,
    })
  )
  return `linear-gradient(to right, ${colors.join(", ")})`
}

function ColorSlider({
  label,
  value,
  max,
  gradient,
  format,
  onChange,
  onCommit,
}: {
  label: string
  value: number
  max: number
  gradient: string
  format: string
  onChange(value: number): void
  onCommit(): void
}) {
  const id = `colour-${label.toLowerCase()}`
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <Label id={id} className="text-xs">
          {label}
        </Label>
        <span className="text-xs text-muted-foreground tabular-nums">
          {format}
        </span>
      </div>
      {/* The track carries the gradient so the slider shows the colours it is
          choosing between, which is most of what makes a picker readable. */}
      <div
        className="rounded-full border border-border/60"
        style={{ background: gradient }}
      >
        <Slider
          aria-labelledby={id}
          min={0}
          max={max}
          step={max / 360}
          value={[value]}
          onValueChange={([next]) => onChange(next)}
          onValueCommit={onCommit}
          className="py-1.5 [&_[data-slot=slider-range]]:bg-transparent [&_[data-slot=slider-track]]:bg-transparent"
        />
      </div>
    </div>
  )
}

function Swatch({
  hex,
  label,
  onClick,
  onRemove,
  draggable,
  onDragStart,
  onDrop,
}: {
  hex: string
  label: string
  onClick(): void
  onRemove?(): void
  draggable?: boolean
  onDragStart?(): void
  onDrop?(): void
}) {
  return (
    <div className="group/swatch relative">
      <button
        type="button"
        aria-label={label}
        title={hex}
        draggable={draggable}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move"
          event.dataTransfer.setData("text/plain", hex)
          onDragStart?.()
        }}
        onDragOver={(event) => {
          if (!onDrop) return
          event.preventDefault()
          event.dataTransfer.dropEffect = "move"
        }}
        onDrop={(event) => {
          if (!onDrop) return
          event.preventDefault()
          onDrop()
        }}
        onClick={onClick}
        className="size-7 rounded-md border border-border/70 shadow-sm transition hover:scale-105"
        style={{ backgroundColor: hex }}
      />
      {onRemove && (
        <button
          type="button"
          aria-label={`Remove ${hex}`}
          onClick={onRemove}
          // Out of the way until the swatch is reached for, but never out of
          // the DOM: a keyboard can still tab to it, and focus reveals it.
          className="pointer-events-none absolute -top-1 -right-1 rounded-full bg-background text-muted-foreground opacity-0 shadow transition-opacity group-hover/swatch:pointer-events-auto group-hover/swatch:opacity-100 hover:text-foreground focus-visible:pointer-events-auto focus-visible:opacity-100"
        >
          <XIcon className="size-3.5" />
        </button>
      )}
    </div>
  )
}

function PaletteSection({
  palette,
  store,
  currentHex,
  onPick,
  onRun,
  startNamed,
}: {
  palette: PaletteRecord
  store: PaletteStore
  currentHex: string
  onPick(hex: string): void
  onRun(work: Promise<unknown>): void
  /** True for a palette just created, which opens waiting for its name. */
  startNamed: boolean
}) {
  const [dragging, setDragging] = useState<number | null>(null)
  const [name, setName] = useState(palette.name)
  const [editing, setEditing] = useState(startNamed)
  // The palette appears in the list before `create` resolves with its id, so
  // this section usually mounts a moment before it is told it is the new one.
  const [wasNamed, setWasNamed] = useState(startNamed)
  if (startNamed !== wasNamed) {
    setWasNamed(startNamed)
    if (startNamed) setEditing(true)
  }
  // Adjusting state during render rather than in an effect: React re-runs this
  // component before touching the DOM, so the field never paints a stale name.
  const [lastName, setLastName] = useState(palette.name)
  if (lastName !== palette.name) {
    setLastName(palette.name)
    setName(palette.name)
  }

  return (
    <section className="space-y-1.5" data-testid={`palette-${palette.name}`}>
      <div className="flex items-center gap-1">
        {editing ? (
          <Input
            autoFocus
            aria-label="Palette name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => {
              setEditing(false)
              if (name.trim() && name !== palette.name)
                onRun(store.rename(palette.id, name))
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur()
              if (event.key === "Escape") {
                setName(palette.name)
                setEditing(false)
              }
            }}
            className="h-7 text-xs"
          />
        ) : (
          <button
            type="button"
            // A single click, so the name is reachable by keyboard too: a
            // palette the spec calls named must be nameable without a mouse.
            onClick={() => setEditing(true)}
            aria-label={`Rename ${palette.name}`}
            className="flex-1 truncate text-left text-xs font-medium"
          >
            {palette.name}
          </button>
        )}
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Add the current colour to ${palette.name}`}
          onClick={() => onRun(store.addColor(palette.id, currentHex))}
          className="size-7 rounded-md"
        >
          <PlusIcon className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Delete ${palette.name}`}
          onClick={() => onRun(store.remove(palette.id))}
          className="size-7 rounded-md"
        >
          <TrashIcon className="size-3.5" />
        </Button>
      </div>
      {palette.colors.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Empty. Add the colour you are painting with.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {palette.colors.map((hex, index) => (
            <Swatch
              key={`${hex}-${index}`}
              hex={hex}
              label={`${palette.name} colour ${index + 1}, ${hex}`}
              draggable
              onDragStart={() => setDragging(index)}
              onDrop={() => {
                if (dragging !== null && dragging !== index)
                  onRun(store.reorder(palette.id, dragging, index))
                setDragging(null)
              }}
              onClick={() => onPick(hex)}
              onRemove={() => onRun(store.removeColorAt(palette.id, index))}
            />
          ))}
        </div>
      )}
    </section>
  )
}

/**
 * The colour picker (23). It is a panel in the docked stack rather than a
 * popover over the canvas: choosing a colour is something an artist does
 * while looking at the painting, and a picker that covers the area being
 * painted makes that impossible.
 */
/** The keyboard never changes under a running tab, so there is nothing to watch. */
const subscribeToPlatform = () => () => {}
const serverAltLabel = () => "Alt"
const readAltLabel = () =>
  /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent)
    ? "Option"
    : "Alt"

export function ColorPanel({
  engine,
  snapshot,
  store,
  onClose,
}: {
  engine: Engine
  snapshot: EngineSnapshot
  store: PaletteStore
  onClose(): void
}) {
  const state = store.usePaletteState()
  const [problem, setProblem] = useState<string | null>(null)
  // A palette just created, so it opens with its name selected rather than
  // leaving the artist to find the rename affordance for it.
  const [naming, setNaming] = useState<string | null>(null)

  /**
   * Runs a store change and says so when it fails. Saving a colour is a small
   * action, but a silent failure is how an artist loses a scheme: a full
   * palette or a dropped connection has to reach them as words.
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
  const [choice, setChoice] = useState<Choice>(() =>
    choiceFromHex(snapshot.color.hex)
  )
  const [hexText, setHexText] = useState(snapshot.color.hex)
  const hex = useMemo(() => hexFor(choice), [choice])
  // Each ramp costs a gamut search per stop, so each is rebuilt only when the
  // axes it is drawn against move — dragging hue does not redraw the hue ramp.
  const { lightness, saturation, hue } = choice
  const hueRamp = useMemo(
    () => ramp("hue", { lightness, saturation }, 24),
    [lightness, saturation]
  )
  const saturationRamp = useMemo(
    () => ramp("saturation", { lightness, hue }),
    [lightness, hue]
  )
  const lightnessRamp = useMemo(
    () => ramp("lightness", { saturation, hue }),
    [saturation, hue]
  )

  // The engine owns the ink, and the eyedropper changes it without going
  // through this panel. When it does, the sliders follow the canvas — adjusted
  // during render rather than in an effect, so no frame shows the old colour.
  // Only a colour the panel did not itself send counts, which is what
  // comparing against the last dispatched hex distinguishes.
  // One key, two names: `altKey` is what the browser reports either way, but a
  // Mac keyboard has no cap reading "Alt" to reach for. Read as an external
  // value rather than derived, because the server has no keyboard to name:
  // "Alt" is what it renders, and the client corrects it as it hydrates.
  const altLabel = useSyncExternalStore(
    subscribeToPlatform,
    readAltLabel,
    serverAltLabel
  )

  const [sentHex, setSentHex] = useState(snapshot.color.hex)
  if (snapshot.color.hex !== sentHex) {
    setSentHex(snapshot.color.hex)
    setChoice(choiceFromHex(snapshot.color.hex))
    setHexText(snapshot.color.hex)
  }

  const apply = (next: Choice) => {
    setChoice(next)
    const nextHex = hexFor(next)
    setHexText(nextHex)
    setSentHex(nextHex)
    void engine.dispatch({ type: "setColor", hex: nextHex })
  }

  /** A colour the artist has settled on, rather than dragged through. */
  const commitColor = (nextHex: string) => {
    setChoice(choiceFromHex(nextHex))
    setHexText(nextHex)
    setSentHex(nextHex)
    void engine.dispatch({ type: "setColor", hex: nextHex })
    run(store.recordUsed(nextHex))
  }

  return (
    <div
      className="flex flex-col gap-3 border-b border-border/70 p-3"
      data-testid="colour-panel"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Colour</h2>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close colour picker"
          onClick={onClose}
          className="size-7 rounded-md"
        >
          <XIcon className="size-3.5" />
        </Button>
      </div>

      {problem && (
        <p role="alert" className="text-xs text-destructive">
          {problem}
        </p>
      )}

      <div className="flex items-center gap-2">
        <div
          data-testid="current-colour"
          data-colour={hex}
          aria-label={`Current colour ${hex}`}
          role="img"
          className="size-10 shrink-0 rounded-lg border border-border/70 shadow-inner"
          style={{ backgroundColor: hex }}
        />
        <Input
          aria-label="Hex colour"
          value={hexText}
          spellCheck={false}
          onChange={(event) => {
            const text = event.target.value
            setHexText(text)
            // Typed hex applies as soon as it is a colour, so the canvas keeps
            // up with the field; the field keeps whatever was typed until it
            // is committed, so a half-typed value is not rewritten underneath.
            if (parseHex(text)) apply(choiceFromHex(text))
          }}
          onBlur={() =>
            parseHex(hexText) ? commitColor(hexFor(choice)) : setHexText(hex)
          }
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur()
          }}
          className="h-9 font-mono text-sm"
        />
      </div>

      <ColorSlider
        label="Hue"
        value={choice.hue}
        max={360}
        format={`${Math.round(choice.hue)}°`}
        gradient={hueRamp}
        onChange={(hue) => apply({ ...choice, hue })}
        onCommit={() => commitColor(hex)}
      />
      <ColorSlider
        label="Saturation"
        value={choice.saturation}
        max={1}
        format={`${Math.round(choice.saturation * 100)}%`}
        gradient={saturationRamp}
        onChange={(saturation) => apply({ ...choice, saturation })}
        onCommit={() => commitColor(hex)}
      />
      <ColorSlider
        label="Lightness"
        value={choice.lightness}
        max={1}
        format={`${Math.round(choice.lightness * 100)}%`}
        gradient={lightnessRamp}
        onChange={(lightness) => apply({ ...choice, lightness })}
        onCommit={() => commitColor(hex)}
      />

      <section className="space-y-1.5">
        <Label className="text-xs">Recent</Label>
        {state.recent.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Colours you paint with collect here.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5" data-testid="recent-colours">
            {state.recent.map((recent) => (
              <Swatch
                key={recent}
                hex={recent}
                label={`Recent colour ${recent}`}
                onClick={() => commitColor(recent)}
              />
            ))}
          </div>
        )}
        {/* The eyedropper has no button to be found on, being a held modifier
            rather than a tool. This is where an artist looks when they want a
            colour, so it is where the way to take one off the canvas belongs. */}
        <p className="text-xs text-muted-foreground">
          Hold{" "}
          <kbd className="rounded border border-border/70 px-1 font-mono text-[0.65rem]">
            {altLabel}
          </kbd>{" "}
          and click the canvas to pick a colour from it.
        </p>
      </section>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Palettes</Label>
          <Button
            variant="ghost"
            size="sm"
            aria-label="New palette"
            onClick={() =>
              void store
                .create("Untitled palette", [hex])
                .then(setNaming, () =>
                  setProblem("That palette could not be created.")
                )
            }
            className="h-7 rounded-md text-xs"
          >
            <PlusIcon className="size-3.5" /> New
          </Button>
        </div>
        {state.palettes.map((palette) => (
          <PaletteSection
            key={palette.id}
            palette={palette}
            store={store}
            currentHex={hex}
            onPick={commitColor}
            onRun={run}
            startNamed={palette.id === naming}
          />
        ))}
        {state.loaded && state.palettes.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No palettes yet. Start one from the colour you are on.
          </p>
        )}
      </div>
    </div>
  )
}
