"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ArrowsCounterClockwiseIcon,
  CheckIcon,
  FlipHorizontalIcon,
  FlipVerticalIcon,
  XIcon,
} from "@phosphor-icons/react"

import type { Engine, EngineSnapshot, ImagePlacement } from "@/engine"
import {
  docToScreen,
  flippedPlacement,
  handlePoints,
  movedPlacement,
  nudgedPlacement,
  placementCorners,
  rotatedPlacement,
  invertMatrix,
  scaledPlacement,
  type PlacementHandle,
  type ViewMatrix,
} from "@/engine"
import { Button } from "@/components/ui/button"

/**
 * The box an artist moves a placed image by (06).
 *
 * Every drag here is a placement — a position, a size, an angle — handed to
 * the engine, which renders the picture from the original each time. Nothing
 * in this file touches a pixel, which is exactly why a photograph can be
 * nudged all afternoon and stay as sharp as the file that was dropped.
 *
 * The box lives in document space and is drawn through the same view matrix
 * the canvas is presented with, so it stays on the picture through a zoom, a
 * pan, a canvas rotation and a flip without knowing anything about them.
 */

/** Fine nudges; the same step a selection has anywhere else. */
const NUDGE = 1
const COARSE_NUDGE = 10
/** How near a right angle a turn snaps, with the modifier held. */
const SNAP_STEP = Math.PI / 12

type Point = { x: number; y: number }

/** Document pixels to CSS pixels of the canvas element. */
function useDocumentToCss(
  canvas: HTMLCanvasElement | null,
  snapshot: EngineSnapshot
) {
  // The view matrix is in backing-store pixels; the overlay is laid out in
  // CSS pixels, so the two differ by whatever the display's density is.
  const [density, setDensity] = useState(1)
  useEffect(() => {
    if (!canvas) return
    const measure = () => {
      const bounds = canvas.getBoundingClientRect()
      setDensity(bounds.width > 0 ? canvas.width / bounds.width : 1)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [canvas])

  return useMemo(() => {
    const matrix = docToScreen(
      snapshot.view,
      { width: snapshot.width, height: snapshot.height },
      { width: canvas?.width ?? 1, height: canvas?.height ?? 1 }
    )
    const [a, b, c, d, e, f] = matrix
    // The view matrix is in backing pixels; one divide puts the whole affine
    // into the CSS pixels this overlay is laid out in.
    const scaled: ViewMatrix = [
      a / density,
      b / density,
      c / density,
      d / density,
      e / density,
      f / density,
    ]
    const inverse = invertMatrix(scaled)
    return {
      toCss: (point: Point) => ({
        x: scaled[0] * point.x + scaled[2] * point.y + scaled[4],
        y: scaled[1] * point.x + scaled[3] * point.y + scaled[5],
      }),
      toDoc: (point: Point) => ({
        x: inverse[0] * point.x + inverse[2] * point.y + inverse[4],
        y: inverse[1] * point.x + inverse[3] * point.y + inverse[5],
      }),
    }
  }, [snapshot.view, snapshot.width, snapshot.height, canvas, density])
}

type Drag =
  | { kind: "move"; from: Point; start: ImagePlacement }
  | { kind: "scale"; handle: Exclude<PlacementHandle, "rotate"> }
  | { kind: "rotate"; start: ImagePlacement; fromAngle: number }

export function ImageTransform({
  engine,
  snapshot,
  canvas,
}: {
  engine: Engine
  snapshot: EngineSnapshot
  canvas: HTMLCanvasElement | null
}) {
  const transform = snapshot.imageTransform
  const { toCss, toDoc } = useDocumentToCss(canvas, snapshot)
  const drag = useRef<Drag | null>(null)
  const box = useRef<HTMLDivElement>(null)

  const adjust = useCallback(
    (placement: ImagePlacement) => {
      void engine
        .dispatch({ type: "adjustImageTransform", placement })
        .catch(() => {
          // A placement the engine will not take — dragged to nothing, or
          // past what it will render — simply does not move the box.
        })
    },
    [engine]
  )

  // The box takes the keyboard as soon as it appears: the arrow keys are how
  // a placement is put exactly where it belongs, and hunting for something to
  // click first would be in the way of that.
  useEffect(() => {
    if (transform) box.current?.focus()
  }, [transform])

  if (!transform) return null
  const placement = transform.placement
  const corners = placementCorners(placement).map(toCss)
  const handles = handlePoints(placement)

  const pointerIn = (event: { clientX: number; clientY: number }): Point => {
    const bounds = canvas?.getBoundingClientRect()
    return toDoc({
      x: event.clientX - (bounds?.left ?? 0),
      y: event.clientY - (bounds?.top ?? 0),
    })
  }

  const angleTo = (point: Point) =>
    Math.atan2(point.y - placement.y, point.x - placement.x)

  const onPointerMove = (event: React.PointerEvent) => {
    const active = drag.current
    if (!active) return
    const point = pointerIn(event)
    if (active.kind === "move")
      adjust(
        movedPlacement(active.start, {
          dx: point.x - active.from.x,
          dy: point.y - active.from.y,
        })
      )
    else if (active.kind === "scale")
      adjust(
        scaledPlacement(placement, active.handle, point, {
          // A corner keeps the picture's shape, because a stretched
          // photograph is nearly always a mistake; Shift is how stretching is
          // asked for on purpose, and an edge handle is one axis anyway.
          preserveAspect: !event.shiftKey && active.handle.includes("-"),
        })
      )
    else {
      const turned = active.start.rotation + (angleTo(point) - active.fromAngle)
      adjust(
        rotatedPlacement(
          placement,
          event.shiftKey ? Math.round(turned / SNAP_STEP) * SNAP_STEP : turned
        )
      )
    }
  }

  const begin = (event: React.PointerEvent<SVGElement>, next: Drag) => {
    event.preventDefault()
    event.stopPropagation()
    ;(event.target as Element).setPointerCapture(event.pointerId)
    drag.current = next
  }

  const end = (event: React.PointerEvent) => {
    if (!drag.current) return
    drag.current = null
    ;(event.target as Element).releasePointerCapture?.(event.pointerId)
  }

  const commit = () => void engine.dispatch({ type: "commitImageTransform" })
  const cancel = () => void engine.dispatch({ type: "cancelImageTransform" })

  const outline = corners.map((point) => `${point.x},${point.y}`).join(" ")
  const handleAt = (name: PlacementHandle) => toCss(handles[name])
  const scaleHandles: Exclude<PlacementHandle, "rotate">[] = [
    "top-left",
    "top",
    "top-right",
    "right",
    "bottom-right",
    "bottom",
    "bottom-left",
    "left",
  ]

  return (
    <div
      ref={box}
      role="group"
      tabIndex={-1}
      aria-label="Move, scale or rotate the placed image"
      data-testid="image-transform"
      className="absolute inset-0 outline-none"
      onKeyDown={(event) => {
        const step = event.shiftKey ? COARSE_NUDGE : NUDGE
        const nudge = (dx: number, dy: number) => {
          event.preventDefault()
          adjust(nudgedPlacement(placement, { dx: dx * step, dy: dy * step }))
        }
        if (event.key === "ArrowLeft") nudge(-1, 0)
        else if (event.key === "ArrowRight") nudge(1, 0)
        else if (event.key === "ArrowUp") nudge(0, -1)
        else if (event.key === "ArrowDown") nudge(0, 1)
        else if (event.key === "Enter") commit()
        else if (event.key === "Escape") cancel()
      }}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <svg
        className="absolute inset-0 h-full w-full"
        // The box is the only thing on this layer that takes a pointer: the
        // rest of the canvas is still the canvas.
        style={{ pointerEvents: "none" }}
      >
        <polygon
          points={outline}
          className="fill-brand-gold/5 stroke-brand-gold"
          strokeWidth={1.5}
          style={{ pointerEvents: "fill", cursor: "move" }}
          onPointerDown={(event) =>
            begin(event, {
              kind: "move",
              from: pointerIn(event),
              start: placement,
            })
          }
        />
        <line
          x1={handleAt("top").x}
          y1={handleAt("top").y}
          x2={handleAt("rotate").x}
          y2={handleAt("rotate").y}
          className="stroke-brand-gold"
          strokeWidth={1.5}
        />
        {scaleHandles.map((name) => {
          const point = handleAt(name)
          return (
            <rect
              key={name}
              data-testid={`transform-handle-${name}`}
              x={point.x - 5}
              y={point.y - 5}
              width={10}
              height={10}
              className="fill-studio-surface stroke-brand-gold"
              strokeWidth={1.5}
              style={{ pointerEvents: "all", cursor: "pointer" }}
              onPointerDown={(event) =>
                begin(event, {
                  kind: "scale",
                  handle: name,
                })
              }
            />
          )
        })}
        <circle
          data-testid="transform-handle-rotate"
          cx={handleAt("rotate").x}
          cy={handleAt("rotate").y}
          r={6}
          className="fill-studio-surface stroke-brand-gold"
          strokeWidth={1.5}
          style={{ pointerEvents: "all", cursor: "grab" }}
          onPointerDown={(event) =>
            begin(event, {
              kind: "rotate",
              start: placement,
              fromAngle: angleTo(pointerIn(event)),
            })
          }
        />
      </svg>

      <div className="absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-studio-edge bg-studio-surface/95 px-3 py-1.5 text-xs shadow-lg">
        <span data-testid="transform-resolution">
          {/* The honest number. Above the picture's own resolution the extra
              pixels are the resampler's invention, and saying so is the
              difference between a tool and a stretch. */}
          {transform.resolution > 1.005
            ? `${Math.round(transform.resolution * 100)}% — larger than the picture’s own detail`
            : `${Math.round(transform.resolution * 100)}% of the picture’s own detail`}
        </span>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Flip the image horizontally"
          onClick={() => adjust(flippedPlacement(placement, "horizontal"))}
        >
          <FlipHorizontalIcon />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Flip the image vertically"
          onClick={() => adjust(flippedPlacement(placement, "vertical"))}
        >
          <FlipVerticalIcon />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Turn the image a quarter turn"
          onClick={() =>
            adjust(
              rotatedPlacement(placement, placement.rotation + Math.PI / 2)
            )
          }
        >
          <ArrowsCounterClockwiseIcon />
        </Button>
        <Button variant="ghost" size="sm" aria-label="Cancel" onClick={cancel}>
          <XIcon />
        </Button>
        <Button variant="default" size="sm" aria-label="Done" onClick={commit}>
          <CheckIcon />
        </Button>
      </div>
    </div>
  )
}
