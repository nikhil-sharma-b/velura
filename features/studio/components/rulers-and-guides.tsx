"use client"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"

import type { Engine, EngineSnapshot, GuideAxis } from "@/engine"

import { rulerTicks } from "../lib/ruler"
import { useDocumentToCss } from "./image-transform"

/** How thick a ruler is, in CSS pixels. */
export const RULER_SIZE = 20
/** How far apart a ruler's labels sit at the least, in CSS pixels. */
const LABEL_SPACING = 60
/** How far either side of a guide a pointer still picks it up. */
const GUIDE_REACH = 4
/**
 * Far enough past the canvas that a guide reaches every edge of the view at
 * any zoom or turn; SVG clips it to the overlay.
 */
const FAR = 1e6

type Point = { x: number; y: number }

type Drag = {
  axis: GuideAxis
  /** The guide being moved; absent while one is dragged out of a ruler. */
  id?: string
  position: number
  /** Over a ruler, letting go takes the guide away (or never lays it down). */
  overRuler: boolean
}

const other = (axis: GuideAxis): GuideAxis => (axis === "x" ? "y" : "x")

/**
 * The rulers along the canvas's top and left edges, reading document pixels
 * under whatever pan, zoom and turn the view is at, and the guides (16): drag
 * one out of a ruler to lay it down, drag it to move it, drag it back onto a
 * ruler to take it away. Each is one step, so undo puts it back.
 */
export function RulersAndGuides({
  engine,
  snapshot,
  canvas,
  rulerLayer,
}: {
  engine: Engine
  snapshot: EngineSnapshot
  canvas: HTMLCanvasElement | null
  /**
   * Where the rulers are drawn: a layer over the studio's controls, as they
   * are controls themselves, while the guides stay beneath them with the
   * canvas (07). A drag out of a ruler still reaches this component, as
   * React carries a portal's events up its own tree. None, and no rulers.
   */
  rulerLayer: HTMLElement | null
}) {
  const { toCss, toDoc } = useDocumentToCss(canvas, snapshot)
  const size = useCssSize(canvas)
  const [drag, setDrag] = useState<Drag | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const update = (next: Drag | null) => {
    dragRef.current = next
    setDrag(next)
  }

  const local = (event: { clientX: number; clientY: number }): Point => {
    const bounds = canvas?.getBoundingClientRect()
    return {
      x: event.clientX - (bounds?.left ?? 0),
      y: event.clientY - (bounds?.top ?? 0),
    }
  }
  const onRuler = (point: Point) =>
    snapshot.rulersVisible && (point.x < RULER_SIZE || point.y < RULER_SIZE)

  // Which document axis each ruler reads: the one that changes faster along
  // it, so a view turned past forty-five degrees swaps what they measure.
  const origin = toDoc({ x: 0, y: 0 })
  const alongTop = toDoc({ x: 1, y: 0 })
  const topAxis: GuideAxis =
    Math.abs(alongTop.x - origin.x) >= Math.abs(alongTop.y - origin.y)
      ? "x"
      : "y"
  const leftAxis = other(topAxis)

  const begin = (event: React.PointerEvent, next: Drag) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    ;(event.target as Element).setPointerCapture?.(event.pointerId)
    update(next)
  }

  const onPointerMove = (event: React.PointerEvent) => {
    const active = dragRef.current
    if (!active) return
    const point = local(event)
    const doc = toDoc(point)
    update({
      ...active,
      // Whole pixels, so a guide lands where paint and pictures do.
      position: Math.round(doc[active.axis]),
      overRuler: onRuler(point),
    })
  }

  const onPointerUp = (event: React.PointerEvent) => {
    const active = dragRef.current
    if (!active) return
    update(null)
    ;(event.target as Element).releasePointerCapture?.(event.pointerId)
    if (active.id === undefined) {
      if (!active.overRuler)
        void engine.dispatch({
          type: "addGuide",
          axis: active.axis,
          position: active.position,
        })
    } else if (active.overRuler)
      void engine.dispatch({ type: "removeGuide", id: active.id })
    else {
      const guide = snapshot.guides.find((g) => g.id === active.id)
      if (guide && guide.position !== active.position)
        void engine.dispatch({
          type: "moveGuide",
          id: active.id,
          position: active.position,
        })
    }
  }

  const endpoints = (axis: GuideAxis, position: number) => {
    const [from, to] =
      axis === "x"
        ? [
            { x: position, y: -FAR },
            { x: position, y: FAR },
          ]
        : [
            { x: -FAR, y: position },
            { x: FAR, y: position },
          ]
    const a = toCss(from)
    const b = toCss(to)
    return { x1: a.x, y1: a.y, x2: b.x, y2: b.y }
  }

  const shown = snapshot.guidesVisible
    ? snapshot.guides.map((guide) =>
        guide.id === drag?.id ? { ...guide, position: drag.position } : guide
      )
    : []
  const preview =
    drag && drag.id === undefined && !drag.overRuler
      ? { axis: drag.axis, position: drag.position }
      : null
  // A guide carried onto a ruler is shown fading, as one about to go.
  const leaving = (id: string) => drag?.id === id && drag.overRuler

  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={(event) => {
        update(null)
        ;(event.target as Element).releasePointerCapture?.(event.pointerId)
      }}
    >
      <svg className="absolute inset-0 size-full overflow-visible" aria-hidden>
        {shown.map((guide) => (
          <g key={guide.id} data-guide>
            <line
              {...endpoints(guide.axis, guide.position)}
              className="stroke-sky-500"
              strokeWidth={1}
              opacity={leaving(guide.id) ? 0.3 : 1}
              data-testid="guide"
              data-axis={guide.axis}
              data-position={guide.position}
            />
            <line
              {...endpoints(guide.axis, guide.position)}
              stroke="transparent"
              strokeWidth={GUIDE_REACH * 2}
              style={{
                pointerEvents: "stroke",
                cursor: guideCursor(guide.axis, toCss),
              }}
              onPointerDown={(event) =>
                begin(event, {
                  axis: guide.axis,
                  id: guide.id,
                  position: guide.position,
                  overRuler: false,
                })
              }
            />
          </g>
        ))}
        {preview && (
          <line
            {...endpoints(preview.axis, preview.position)}
            className="stroke-sky-500"
            strokeWidth={1}
            data-testid="guide-preview"
          />
        )}
      </svg>

      {rulerLayer &&
        snapshot.rulersVisible &&
        createPortal(
          <>
            <Ruler
              side="top"
              length={size.width}
              docAt={(s) => toDoc({ x: s, y: 0 })[topAxis]}
              onPointerDown={(event) => {
                const point = local(event)
                begin(event, {
                  axis: other(topAxis),
                  position: Math.round(toDoc(point)[other(topAxis)]),
                  overRuler: true,
                })
              }}
            />
            <Ruler
              side="left"
              length={size.height}
              docAt={(s) => toDoc({ x: 0, y: s })[leftAxis]}
              onPointerDown={(event) => {
                const point = local(event)
                begin(event, {
                  axis: other(leftAxis),
                  position: Math.round(toDoc(point)[other(leftAxis)]),
                  overRuler: true,
                })
              }}
            />
            <div
              className="absolute top-0 left-0 border-r border-b border-studio-edge bg-studio-surface"
              style={{ width: RULER_SIZE, height: RULER_SIZE }}
            />
          </>,
          rulerLayer
        )}
    </div>
  )
}

function Ruler({
  side,
  length,
  docAt,
  onPointerDown,
}: {
  side: "top" | "left"
  length: number
  docAt: (screen: number) => number
  onPointerDown: (event: React.PointerEvent) => void
}) {
  const ticks = rulerTicks(docAt, length, LABEL_SPACING)
  const top = side === "top"
  return (
    <svg
      data-testid={`ruler-${side}`}
      aria-label={top ? "Top ruler" : "Left ruler"}
      role="img"
      className={
        top
          ? "absolute top-0 left-0 w-full border-b border-studio-edge bg-studio-surface"
          : "absolute top-0 left-0 h-full border-r border-studio-edge bg-studio-surface"
      }
      style={{
        [top ? "height" : "width"]: RULER_SIZE,
        pointerEvents: "auto",
        cursor: top ? "row-resize" : "col-resize",
        touchAction: "none",
      }}
      onPointerDown={onPointerDown}
    >
      {ticks.map(({ value, at }) =>
        top ? (
          <g key={value}>
            <line
              x1={at}
              x2={at}
              y1={RULER_SIZE / 2}
              y2={RULER_SIZE}
              className="stroke-muted-foreground"
            />
            <text
              x={at + 3}
              y={10}
              className="fill-muted-foreground text-[9px] tabular-nums select-none"
            >
              {value}
            </text>
          </g>
        ) : (
          <g key={value}>
            <line
              y1={at}
              y2={at}
              x1={RULER_SIZE / 2}
              x2={RULER_SIZE}
              className="stroke-muted-foreground"
            />
            <text
              x={10}
              y={at + 3}
              transform={`rotate(-90 10 ${at + 3})`}
              className="fill-muted-foreground text-[9px] tabular-nums select-none"
            >
              {value}
            </text>
          </g>
        )
      )}
    </svg>
  )
}

/** A resize cursor across the guide as it runs on screen. */
function guideCursor(
  axis: GuideAxis,
  toCss: (point: Point) => Point
): "col-resize" | "row-resize" {
  const a = toCss({ x: 0, y: 0 })
  const b = toCss(axis === "x" ? { x: 0, y: 1 } : { x: 1, y: 0 })
  return Math.abs(b.x - a.x) > Math.abs(b.y - a.y) ? "row-resize" : "col-resize"
}

/** The canvas element's CSS size, kept current as it is resized. */
function useCssSize(canvas: HTMLCanvasElement | null) {
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    if (!canvas) return
    const measure = () => {
      const bounds = canvas.getBoundingClientRect()
      setSize({ width: bounds.width, height: bounds.height })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [canvas])
  return size
}
