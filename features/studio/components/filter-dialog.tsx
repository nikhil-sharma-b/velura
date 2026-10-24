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
import {
  FILTER_LABELS,
  MAX_BLUR_RADIUS,
  type Engine,
  type EngineSnapshot,
  type Filter,
} from "@/engine"

import { SliderSetting } from "./slider-setting"

/**
 * The settings of the filter open on a layer (18). The dialog is the engine's
 * open filter: it shows while there is one, every change is previewed on the
 * canvas at once, and closing it any way but Apply puts the pixels back.
 *
 * The overlay is clear so the preview is seen as it will be kept, but it is
 * still there: the pen cannot reach a layer whose pixels are being redrawn.
 */
export function FilterDialog({
  engine,
  open,
}: {
  engine: Engine
  open: EngineSnapshot["filter"]
}) {
  return (
    <Dialog
      open={!!open}
      onOpenChange={(next) => {
        if (!next) void engine.dispatch({ type: "cancelFilter" })
      }}
    >
      <DialogContent
        overlayClassName="bg-transparent"
        className="top-auto bottom-6 translate-y-0"
        data-filter-dialog
      >
        {open && (
          <FilterSettings
            key={`${open.layerId}:${open.filter.kind}`}
            engine={engine}
            initial={open.filter}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function FilterSettings({
  engine,
  initial,
}: {
  engine: Engine
  initial: Filter
}) {
  const [filter, setFilter] = useState(initial)

  function change(next: Filter) {
    setFilter(next)
    void engine.dispatch({ type: "previewFilter", filter: next })
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{FILTER_LABELS[filter.kind]}</DialogTitle>
        <DialogDescription>
          {filter.kind === "blur"
            ? "Softens the layer, within the selection if there is one."
            : "Adjusts the layer's colour, within the selection if there is one."}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        {filter.kind === "hsl" && (
          <>
            <SliderSetting
              label="Hue"
              value={filter.hue}
              min={-180}
              max={180}
              step={1}
              unit="°"
              onChange={(hue) =>
                filter.kind === "hsl" && change({ ...filter, hue })
              }
            />
            <SliderSetting
              label="Saturation"
              value={filter.saturation}
              min={-100}
              max={100}
              step={1}
              onChange={(saturation) =>
                filter.kind === "hsl" && change({ ...filter, saturation })
              }
            />
            <SliderSetting
              label="Lightness"
              value={filter.lightness}
              min={-100}
              max={100}
              step={1}
              onChange={(lightness) =>
                filter.kind === "hsl" && change({ ...filter, lightness })
              }
            />
          </>
        )}
        {filter.kind === "brightnessContrast" && (
          <>
            <SliderSetting
              label="Brightness"
              value={filter.brightness}
              min={-100}
              max={100}
              step={1}
              onChange={(brightness) =>
                filter.kind === "brightnessContrast" &&
                change({ ...filter, brightness })
              }
            />
            <SliderSetting
              label="Contrast"
              value={filter.contrast}
              min={-100}
              max={100}
              step={1}
              onChange={(contrast) =>
                filter.kind === "brightnessContrast" &&
                change({ ...filter, contrast })
              }
            />
          </>
        )}
        {filter.kind === "blur" && (
          <SliderSetting
            label="Radius"
            value={filter.radius}
            min={0}
            max={MAX_BLUR_RADIUS}
            step={0.5}
            decimals={1}
            unit="px"
            onChange={(radius) => change({ kind: "blur", radius })}
          />
        )}
      </div>
      <DialogFooter>
        <Button
          variant="outline"
          onClick={() => void engine.dispatch({ type: "cancelFilter" })}
        >
          Cancel
        </Button>
        <Button onClick={() => void engine.dispatch({ type: "applyFilter" })}>
          Apply
        </Button>
      </DialogFooter>
    </>
  )
}
