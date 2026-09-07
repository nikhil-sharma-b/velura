"use client"

import * as React from "react"

import { ArrowCounterClockwiseIcon, TrashIcon } from "@phosphor-icons/react"
import { cva, type VariantProps } from "class-variance-authority"

import {
  type CurvePoint,
  curveSegment,
  sampleCurve,
} from "@/engine/brush/curve"

import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { clamp, cn } from "@/lib/utils"

/** The engine's curve point, named for the control that edits it. */
export type PressureCurvePoint = CurvePoint

const GRID_W = 150
const GRID_H = 100

// The presets and the default come from the engine, which is what samples
// them once a stroke is under way: a copy here would be a second answer to
// what "Light" means.
import {
  DEFAULT_PRESSURE_PRESET,
  PRESSURE_PRESET_COUNT,
  pressureCurvePreset,
} from "@/engine/input/pressure-curve"

export { DEFAULT_PRESSURE_PRESET, PRESSURE_PRESET_COUNT, pressureCurvePreset }

/**
 * The default as editable points. Same generator as the engine's frozen copy;
 * this one is what a form holds and what the editor drags.
 */
export const DEFAULT_PRESSURE_CURVE: PressureCurvePoint[] = pressureCurvePreset(
  DEFAULT_PRESSURE_PRESET
)

// Spline through every point, emitted as cubic beziers in grid coordinates.
// The segments come from the engine, so the drawn curve and the curve a brush
// is evaluated against cannot drift apart.
function buildPath(points: readonly PressureCurvePoint[]) {
  if (points.length < 2) return ""
  const px = (p: PressureCurvePoint) => `${p.x * GRID_W} ${(1 - p.y) * GRID_H}`
  let d = `M ${px(points[0])}`
  for (let i = 0; i < points.length - 1; i++) {
    const { c1, c2, p2 } = curveSegment(points, i)
    d += ` C ${px(c1)}, ${px(c2)}, ${px(p2)}`
  }
  return d
}

/** Output multiplier for a raw pressure reading, both in [0, 1]. */
export function samplePressureCurve(
  points: readonly PressureCurvePoint[],
  pressure: number
) {
  return sampleCurve(points, pressure)
}

const pressureCurveVariants = cva("flex w-full flex-col", {
  variants: {
    size: {
      sm: "max-w-44 gap-2",
      md: "max-w-56 gap-2.5",
      lg: "max-w-72 gap-3",
    },
  },
  defaultVariants: {
    size: "sm",
  },
})

const sizeStyles = {
  sm: { label: "text-xs", trash: "icon-xs", reset: "xs" },
  md: { label: "text-xs", trash: "icon-xs", reset: "sm" },
  lg: { label: "text-sm", trash: "icon-sm", reset: "default" },
} as const

// Stroke width in px at full pressure with an identity curve.
const TEST_BRUSH_MAX = 16

type PressureTestAreaProps = {
  curve?: readonly PressureCurvePoint[]
  disabled?: boolean
  className?: string
  labelClassName?: string
}

function PressureTestArea({
  curve,
  disabled,
  className,
  labelClassName,
}: PressureTestAreaProps) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const lastPoint = React.useRef<{ x: number; y: number } | null>(null)
  // Cached for the duration of one stroke; cleared on pointer-up
  const canvasRect = React.useRef<DOMRect | null>(null)
  const strokeColor = React.useRef<string | null>(null)

  React.useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const observer = new ResizeObserver(([entry]) => {
      const dpr = window.devicePixelRatio || 1
      const width = Math.max(1, Math.round(entry.contentRect.width * dpr))
      const height = Math.max(1, Math.round(entry.contentRect.height * dpr))
      // Skip no-op resizes so we never feed the observer its own layout change
      if (canvas.width === width && canvas.height === height) return
      canvas.width = width
      canvas.height = height
      // setTransform (not scale) so repeated calls stay idempotent
      canvas.getContext("2d")?.setTransform(dpr, 0, 0, dpr, 0, 0)
    })
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [])

  function toLocal(event: React.PointerEvent) {
    const rect = (canvasRect.current ??=
      canvasRef.current!.getBoundingClientRect())
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  function strokeWidth(event: React.PointerEvent) {
    // Mice report no pressure; pretend half pressure so the curve still shows
    const pressure = event.pressure > 0 ? event.pressure : 0.5
    const output = samplePressureCurve(
      curve ?? DEFAULT_PRESSURE_CURVE,
      pressure
    )
    return Math.max(0.5, output * TEST_BRUSH_MAX)
  }

  function drawTo(event: React.PointerEvent) {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext("2d")
    const from = lastPoint.current
    if (!canvas || !ctx || !from) return
    const to = toLocal(event)
    ctx.strokeStyle = strokeColor.current ??= getComputedStyle(canvas).color
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
    ctx.lineWidth = strokeWidth(event)
    ctx.beginPath()
    ctx.moveTo(from.x, from.y)
    ctx.lineTo(to.x, to.y)
    ctx.stroke()
    lastPoint.current = to
  }

  function handlePointerDown(event: React.PointerEvent) {
    if (disabled) return
    canvasRef.current?.setPointerCapture(event.pointerId)
    const p = toLocal(event)
    lastPoint.current = p
    drawTo(event)
  }

  function handlePointerUp(event: React.PointerEvent) {
    lastPoint.current = null
    canvasRect.current = null
    strokeColor.current = null
    canvasRef.current?.releasePointerCapture(event.pointerId)
  }

  function clear() {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext("2d")
    if (!canvas || !ctx) return
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.restore()
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex justify-end">
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className={cn("text-muted-foreground", labelClassName)}
          onClick={clear}
          disabled={disabled}
          aria-label="Clear test area"
        >
          <ArrowCounterClockwiseIcon />
          Test area
        </Button>
      </div>
      <canvas
        ref={canvasRef}
        className={cn(
          "aspect-3/2 w-full touch-none border border-border bg-muted/30 text-foreground sm:aspect-auto sm:h-auto sm:min-h-32 sm:flex-1",
          disabled && "pointer-events-none opacity-50"
        )}
        aria-label="Pressure test area, draw to preview stroke width"
        onPointerDown={handlePointerDown}
        onPointerMove={(event) => lastPoint.current && drawTo(event)}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />
    </div>
  )
}

type PressureCurveProps = {
  /** Readonly, so a control can be driven straight off an engine snapshot. */
  value?: readonly PressureCurvePoint[]
  onChange?: (value: PressureCurvePoint[]) => void
  disabled?: boolean
  className?: string
  id?: string
  testArea?: boolean
} & VariantProps<typeof pressureCurveVariants>

function PressureCurve({
  value,
  onChange,
  disabled,
  className,
  id,
  size,
  testArea = false,
}: PressureCurveProps) {
  const styles = sizeStyles[size ?? "sm"]
  const points = value?.length ? value : DEFAULT_PRESSURE_CURVE
  const svgRef = React.useRef<SVGSVGElement>(null)
  // Cached for the duration of one drag; cleared on pointer-up
  const gridRect = React.useRef<DOMRect | null>(null)
  const dragIndex = React.useRef<number | null>(null)
  const [selected, setSelected] = React.useState<number | null>(null)
  const [presetPosition, setPresetPosition] = React.useState(
    DEFAULT_PRESSURE_PRESET
  )

  const isEndpoint = (index: number) =>
    index === 0 || index === points.length - 1

  function toUnit(event: React.PointerEvent) {
    const rect = (gridRect.current ??= svgRef.current!.getBoundingClientRect())
    return {
      x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
      y: clamp(1 - (event.clientY - rect.top) / rect.height, 0, 1),
    }
  }

  function startDrag(event: React.PointerEvent, index: number) {
    dragIndex.current = index
    setSelected(index)
    svgRef.current?.setPointerCapture(event.pointerId)
  }

  function handleGridPointerDown(event: React.PointerEvent) {
    if (disabled) return
    const p = toUnit(event)
    // Grab an existing point when close enough, otherwise add a new one
    const nearest = points.findIndex(
      (pt) => Math.hypot(pt.x - p.x, pt.y - p.y) < 0.06
    )
    if (nearest !== -1) {
      startDrag(event, nearest)
      return
    }
    const insertAt = points.findIndex((pt) => pt.x > p.x)
    if (insertAt <= 0) return
    onChange?.([...points.slice(0, insertAt), p, ...points.slice(insertAt)])
    startDrag(event, insertAt)
  }

  function handlePointerMove(event: React.PointerEvent) {
    const index = dragIndex.current
    if (index === null) return
    const p = toUnit(event)
    const next = [...points]
    next[index] = {
      // Endpoints only move vertically, inner points stay between neighbors
      x: isEndpoint(index)
        ? points[index].x
        : clamp(p.x, points[index - 1].x + 0.02, points[index + 1].x - 0.02),
      y: p.y,
    }
    onChange?.(next)
  }

  function handlePointerUp(event: React.PointerEvent) {
    if (dragIndex.current === null) return
    dragIndex.current = null
    gridRect.current = null
    svgRef.current?.releasePointerCapture(event.pointerId)
  }

  function deleteSelected() {
    if (selected === null || isEndpoint(selected)) return
    onChange?.(points.filter((_, index) => index !== selected))
    setSelected(null)
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault()
      deleteSelected()
    }
  }

  function applyPreset(position: number) {
    setPresetPosition(position)
    setSelected(null)
    onChange?.(pressureCurvePreset(position))
  }

  function reset() {
    applyPreset(DEFAULT_PRESSURE_PRESET)
  }

  return (
    <div id={id} className={cn("flex w-full gap-3 max-sm:flex-col", className)}>
      <div
        className={cn(
          pressureCurveVariants({ size }),
          testArea && "max-w-none sm:flex-1 sm:basis-0"
        )}
      >
        <div className="flex flex-col gap-2">
          <div
            className={cn(
              "flex justify-between text-muted-foreground",
              styles.label
            )}
          >
            <span>Light</span>
            <span>Heavy</span>
          </div>
          <Slider
            min={0}
            max={PRESSURE_PRESET_COUNT - 1}
            step={1}
            ticks
            value={[presetPosition]}
            onValueChange={([position]) => applyPreset(position)}
            disabled={disabled}
            aria-label="Pressure sensitivity"
          />
        </div>
        <div className="flex flex-col">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${GRID_W} ${GRID_H}`}
            className={cn(
              "aspect-3/2 w-full touch-none border border-border bg-card outline-none focus-visible:ring-1 focus-visible:ring-ring",
              disabled && "pointer-events-none opacity-50"
            )}
            tabIndex={disabled ? -1 : 0}
            role="application"
            aria-label="Pressure curve editor"
            onPointerDown={handleGridPointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onKeyDown={handleKeyDown}
          >
            {[1, 2, 3].map((line) => (
              <React.Fragment key={line}>
                <line
                  x1={(line * GRID_W) / 4}
                  y1={0}
                  x2={(line * GRID_W) / 4}
                  y2={GRID_H}
                  className="stroke-border"
                  strokeWidth={0.5}
                />
                <line
                  x1={0}
                  y1={(line * GRID_H) / 4}
                  x2={GRID_W}
                  y2={(line * GRID_H) / 4}
                  className="stroke-border"
                  strokeWidth={0.5}
                />
              </React.Fragment>
            ))}
            <path
              d={buildPath(points)}
              fill="none"
              className="stroke-foreground/70"
              strokeWidth={1.25}
            />
            {points.map((point, index) => (
              <circle
                key={index}
                cx={point.x * GRID_W}
                cy={(1 - point.y) * GRID_H}
                r={selected === index ? 3 : 2.5}
                strokeWidth={1.25}
                className={cn(
                  "cursor-grab stroke-foreground active:cursor-grabbing",
                  selected === index ? "fill-foreground" : "fill-card"
                )}
                onPointerDown={(event) => {
                  event.stopPropagation()
                  startDrag(event, index)
                }}
              />
            ))}
          </svg>
          <div className="flex justify-end border border-t-0 border-border bg-muted/50 px-2 py-1">
            <Button
              type="button"
              variant="ghost"
              size={styles.trash}
              onClick={deleteSelected}
              disabled={disabled || selected === null || isEndpoint(selected)}
              aria-label="Delete selected point"
            >
              <TrashIcon />
            </Button>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size={styles.reset}
          onClick={reset}
          disabled={disabled}
        >
          <ArrowCounterClockwiseIcon />
          Reset
        </Button>
      </div>
      {testArea && (
        <PressureTestArea
          curve={points}
          disabled={disabled}
          labelClassName={styles.label}
          className="min-w-0 sm:flex-1 sm:basis-0"
        />
      )}
    </div>
  )
}

export { PressureCurve, PressureTestArea }
