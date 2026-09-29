"use client"

import { useRef, useState } from "react"

import type { Engine, EngineSnapshot, StraightEdge } from "@/engine"

import { useDocumentToCss } from "./image-transform"

/** How far along the edge, in CSS pixels, its turning handle sits. */
const TURN_REACH = 90
/** Shift turns the edge in steps of this many radians. */
const TURN_STEP = Math.PI / 12
/** Past every edge of the view at any zoom; SVG clips it to the overlay. */
const FAR = 1e6

type Point = { x: number; y: number }
type Drag = { kind: "move" | "turn"; grab: Point; from: StraightEdge }

/**
 * The straight-edge (17): a line across the canvas every stroke, brush or
 * eraser, is held to. Drag its centre to move it and its round handle to turn it; Shift turns
 * it in fifteen-degree steps. The engine holds it; this only draws and drags.
 */
export function StraightEdgeOverlay({
  engine,
  snapshot,
  canvas,
}: {
  engine: Engine
  snapshot: EngineSnapshot
  canvas: HTMLCanvasElement | null
}) {
  const { toCss, toDoc } = useDocumentToCss(canvas, snapshot)
  const [dragged, setDraggedState] = useState<StraightEdge | null>(null)
  // Read on pointer-up, which may come before a render has caught up.
  const draggedRef = useRef<StraightEdge | null>(null)
  const setDragged = (next: StraightEdge | null) => {
    draggedRef.current = next
    setDraggedState(next)
  }
  const dragRef = useRef<Drag | null>(null)
  const edge = dragged ?? snapshot.straightEdge
  if (!edge) return null

  const local = (event: { clientX: number; clientY: number }): Point => {
    const bounds = canvas?.getBoundingClientRect()
    return {
      x: event.clientX - (bounds?.left ?? 0),
      y: event.clientY - (bounds?.top ?? 0),
    }
  }

  const dx = Math.cos(edge.angle)
  const dy = Math.sin(edge.angle)
  const centre = toCss(edge)
  const a = toCss({ x: edge.x - dx * FAR, y: edge.y - dy * FAR })
  const b = toCss({ x: edge.x + dx * FAR, y: edge.y + dy * FAR })
  // Along the edge on screen, whatever the view's turn or flip.
  const onScreen = toCss({ x: edge.x + dx, y: edge.y + dy })
  const along = Math.hypot(onScreen.x - centre.x, onScreen.y - centre.y) || 1
  const handle = {
    x: centre.x + ((onScreen.x - centre.x) / along) * TURN_REACH,
    y: centre.y + ((onScreen.y - centre.y) / along) * TURN_REACH,
  }

  const begin = (event: React.PointerEvent, kind: Drag["kind"]) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    ;(event.target as Element).setPointerCapture?.(event.pointerId)
    dragRef.current = { kind, grab: toDoc(local(event)), from: edge }
  }

  const onPointerMove = (event: React.PointerEvent) => {
    const drag = dragRef.current
    if (!drag) return
    const at = toDoc(local(event))
    if (drag.kind === "move")
      setDragged({
        ...drag.from,
        x: drag.from.x + at.x - drag.grab.x,
        y: drag.from.y + at.y - drag.grab.y,
      })
    else {
      let angle = Math.atan2(at.y - drag.from.y, at.x - drag.from.x)
      if (event.shiftKey) angle = Math.round(angle / TURN_STEP) * TURN_STEP
      setDragged({ ...drag.from, angle })
    }
  }

  const onPointerUp = (event: React.PointerEvent) => {
    if (!dragRef.current) return
    dragRef.current = null
    ;(event.target as Element).releasePointerCapture?.(event.pointerId)
    const placed = draggedRef.current
    if (!placed) return
    // Held until the engine has published it, so the edge never jumps back.
    void engine
      .dispatch({ type: "setStraightEdge", edge: placed })
      .finally(() => setDragged(null))
  }

  return (
    <svg
      className="pointer-events-none absolute inset-0 size-full overflow-visible"
      data-testid="straight-edge"
      data-angle={edge.angle}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        dragRef.current = null
        setDragged(null)
      }}
    >
      <line
        x1={a.x}
        y1={a.y}
        x2={b.x}
        y2={b.y}
        className="stroke-fuchsia-500"
        strokeWidth={1.5}
        strokeDasharray="6 4"
      />
      <circle
        cx={centre.x}
        cy={centre.y}
        r={7}
        className="fill-studio-surface stroke-fuchsia-500"
        strokeWidth={1.5}
        style={{ pointerEvents: "auto", cursor: "move", touchAction: "none" }}
        aria-label="Move the straight-edge"
        data-testid="straight-edge-move"
        onPointerDown={(event) => begin(event, "move")}
      />
      <circle
        cx={handle.x}
        cy={handle.y}
        r={5}
        className="fill-fuchsia-500"
        style={{ pointerEvents: "auto", cursor: "grab", touchAction: "none" }}
        aria-label="Turn the straight-edge"
        data-testid="straight-edge-turn"
        onPointerDown={(event) => begin(event, "turn")}
      />
    </svg>
  )
}
