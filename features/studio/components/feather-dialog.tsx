"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

import { SliderSetting } from "./slider-setting"

/** The radius bounds feathering offers, in document pixels. */
const MIN_FEATHER_RADIUS = 1
const MAX_FEATHER_RADIUS = 200

/**
 * How far to feather the selection (11, 04), asked by the "Feather
 * selection" command however it was reached: palette, key or the selection's
 * options. Nothing happens until Apply, which feathers once, as one undo step.
 * Unlike a filter's dialog it previews nothing, so it is the studio's own
 * state rather than the engine's.
 */
export function FeatherDialog({
  open,
  radius,
  onApply,
  onOpenChange,
}: {
  open: boolean
  /** Where the radius starts: the one last applied. */
  radius: number
  onApply(radius: number): void
  onOpenChange(open: boolean): void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {/* Kept while it animates out, so it does not empty first; each
            opening starts afresh from the radius last applied. */}
        <FeatherSettings
          key={`${open}`}
          initial={radius}
          onApply={(next) => {
            onApply(next)
            onOpenChange(false)
          }}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

function FeatherSettings({
  initial,
  onApply,
  onCancel,
}: {
  initial: number
  onApply(radius: number): void
  onCancel(): void
}) {
  const [radius, setRadius] = useState(initial)
  // Not a form: Enter in the radius field commits the number, and a submit
  // on the same key would apply the radius the field held before it.
  return (
    <>
      <DialogHeader>
        <DialogTitle>Feather selection</DialogTitle>
        <DialogDescription>
          Softens the selection&apos;s edge, so what is painted or lifted
          through it fades out across this many pixels.
        </DialogDescription>
      </DialogHeader>
      <SliderSetting
        label="Feather radius"
        value={radius}
        min={MIN_FEATHER_RADIUS}
        max={MAX_FEATHER_RADIUS}
        step={1}
        unit="px"
        onChange={setRadius}
      />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" onClick={() => onApply(radius)}>
          Apply
        </Button>
      </DialogFooter>
    </>
  )
}
