"use client"

import { useId } from "react"

import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"

/**
 * One named setting: a label, the value in the units the artist thinks in, and
 * the slider that moves it.
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
  format,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  /** The value as the artist reads it: pixels, per cent, degrees. */
  format: string
  onChange(value: number): void
}) {
  // Generated, because the same setting can appear twice on one page: the
  // canvas's size slider and the editor's are two controls over one value.
  const id = useId()
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
