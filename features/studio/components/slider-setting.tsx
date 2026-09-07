"use client"

import { useId, useRef, useState } from "react"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"

/**
 * A number the artist can both drag to and type. It reads in the units they
 * think in — pixels, per cent, degrees — so the field carries the unit beside
 * it rather than inside the value.
 *
 * While the field has focus it holds the typed text as-is, because a half-typed
 * "1." or "" is a number on its way to being one; the value only moves when the
 * entry is committed on Enter or blur, and Escape abandons it. Anything
 * unreadable falls back to the value that is actually set.
 */
export function NumberField({
  value,
  min,
  max,
  step,
  decimals,
  unit,
  label,
  labelledBy,
  className,
  onCommit,
}: {
  /** In display units, already scaled. */
  value: number
  min: number
  max: number
  /** One press of an arrow key, in display units. Shift takes ten of them. */
  step: number
  decimals: number
  unit?: string
  label?: string
  labelledBy?: string
  className?: string
  /** Called with a finite value clamped to [min, max], in display units. */
  onCommit(value: number): void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  // The same draft, readable synchronously. Enter commits and then blurs, and
  // the blur handler runs before React has re-rendered, so a handler reading
  // the state would still see the entry it has just consumed.
  const pending = useRef<string | null>(null)

  function edit(text: string | null): void {
    pending.current = text
    setDraft(text)
  }

  /**
   * Commits the draft, and only the draft: Enter blurs the field, so without
   * this guard the blur commits the same entry a second time — and a setting
   * that is dispatched as a change from where it was (the zoom is) would then
   * apply that change twice, landing past what was asked for.
   */
  function commit(): void {
    const entry = pending.current
    if (entry === null) return
    edit(null)
    const typed = Number.parseFloat(entry)
    if (!Number.isFinite(typed)) return
    const clamped = Math.min(max, Math.max(min, typed))
    // Rounded to what the field can show, so reading it back gives the same
    // number the artist typed rather than a long tail they cannot see.
    const rounded = Number(clamped.toFixed(decimals))
    if (rounded !== value) onCommit(rounded)
  }

  /**
   * Steps from what the field is showing, so an arrow after a half-finished
   * entry moves that entry rather than the value it has not replaced yet.
   */
  function nudge(direction: 1 | -1, coarse: boolean): void {
    const shown = Number.parseFloat(pending.current ?? String(value))
    const from = Number.isFinite(shown) ? shown : value
    const next = from + direction * step * (coarse ? 10 : 1)
    edit(null)
    const clamped = Number(Math.min(max, Math.max(min, next)).toFixed(decimals))
    if (clamped !== value) onCommit(clamped)
  }

  return (
    <span className="flex items-baseline gap-1 text-xs text-muted-foreground">
      <Input
        // Text, not number: the spinner and the wheel-to-change behaviour both
        // fight a canvas, and parsing is ours either way.
        type="text"
        inputMode="decimal"
        aria-label={label}
        aria-labelledby={labelledBy}
        value={draft ?? value.toFixed(decimals)}
        onChange={(event) => edit(event.target.value)}
        onBlur={() => commit()}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            commit()
            event.currentTarget.blur()
          } else if (event.key === "Escape") {
            edit(null)
            event.currentTarget.blur()
          } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            // Ours rather than the caret's: in a field holding one number
            // there is nowhere for up and down to go.
            event.preventDefault()
            nudge(event.key === "ArrowUp" ? 1 : -1, event.shiftKey)
          }
          // The canvas listens for keys on the window; typing a value is not
          // meant to zoom or pick a tool.
          event.stopPropagation()
        }}
        // Tinted rather than transparent: over the studio's own translucent
        // panels a bare border all but disappears, and a field that does not
        // look like one does not get typed into.
        className={`h-6 border-foreground/15 bg-foreground/8 px-1.5 text-right text-foreground tabular-nums hover:border-foreground/30 ${className ?? "w-12"}`}
      />
      {unit && <span>{unit}</span>}
    </span>
  )
}

/**
 * One named setting: a label, the value in the units the artist thinks in as a
 * field they can type into, and the slider that moves it.
 *
 * Shared between the brush editor and the controls on the canvas, so that the
 * quick size and opacity adjustments read as the same control as the ones
 * inside the editor — which they are, pointed at the same brush.
 */
export function SliderSetting({
  label,
  value,
  min,
  max,
  step,
  scale = 1,
  decimals = 0,
  unit,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  /**
   * Display units per stored unit: 2 turns a radius into a diameter, 100 turns
   * a fraction into per cent. Every setting here scales linearly, so the field
   * and the slider stay two views of one number.
   */
  scale?: number
  decimals?: number
  /** How the artist reads the number: px, %, °. */
  unit?: string
  onChange(value: number): void
}) {
  // Generated, because the same setting can appear twice on one page: the
  // canvas's size slider and the editor's are two controls over one value.
  const id = useId()
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label id={id} className="text-xs">
          {label}
        </Label>
        <NumberField
          value={value * scale}
          min={min * scale}
          max={max * scale}
          step={step * scale}
          decimals={decimals}
          unit={unit}
          label={label}
          onCommit={(next) => onChange(next / scale)}
        />
      </div>
      <Slider
        aria-labelledby={id}
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={([next]) => onChange(next)}
      />
    </div>
  )
}
