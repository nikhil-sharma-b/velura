"use client"

import { Slider as SliderPrimitive } from "radix-ui"
import * as React from "react"

import { cn } from "@/lib/utils"

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  step = 1,
  ticks = false,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root> & {
  ticks?: boolean
}) {
  const _values = React.useMemo(
    () =>
      Array.isArray(value)
        ? value
        : Array.isArray(defaultValue)
          ? defaultValue
          : [min, max],
    [value, defaultValue, min, max]
  )

  const tickPositions = React.useMemo(() => {
    if (!ticks || step <= 0 || max <= min) return []
    return Array.from(
      { length: Math.floor((max - min) / step) + 1 },
      (_, index) => ((index * step) / (max - min)) * 100
    )
  }, [ticks, min, max, step])

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      step={step}
      className={cn(
        "relative flex w-full touch-none items-center select-none data-disabled:opacity-50 data-vertical:h-full data-vertical:min-h-40 data-vertical:w-auto data-vertical:flex-col",
        className
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className="relative grow overflow-hidden rounded-none bg-muted data-horizontal:h-1 data-horizontal:w-full data-vertical:h-full data-vertical:w-1"
      >
        <SliderPrimitive.Range
          data-slot="slider-range"
          className="absolute bg-primary select-none data-horizontal:h-full data-vertical:w-full"
        />
      </SliderPrimitive.Track>
      {tickPositions.map((position) => (
        <span
          key={position}
          data-slot="slider-tick"
          className={cn(
            "pointer-events-none absolute bg-muted-foreground/40",
            props.orientation === "vertical"
              ? "h-px w-2.5 translate-y-1/2"
              : "h-2.5 w-px -translate-x-1/2"
          )}
          style={
            props.orientation === "vertical"
              ? { bottom: `${position}%` }
              : { left: `${position}%` }
          }
        />
      ))}
      {Array.from({ length: _values.length }, (_, index) => (
        <SliderPrimitive.Thumb
          data-slot="slider-thumb"
          key={index}
          // The thumb carries role="slider", so the accessible name belongs
          // here rather than on the wrapper Radix puts the props on.
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          className="relative block size-3 shrink-0 rounded-none border border-ring bg-white ring-ring/50 transition-[color,box-shadow] select-none after:absolute after:-inset-2 hover:ring-1 focus-visible:ring-1 focus-visible:outline-hidden active:ring-1 disabled:pointer-events-none disabled:opacity-50"
        />
      ))}
    </SliderPrimitive.Root>
  )
}

export { Slider }
