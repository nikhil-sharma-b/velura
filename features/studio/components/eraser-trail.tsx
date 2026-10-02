"use client"

import { useEffect, useRef } from "react"

import { isViewPanButton } from "@/engine/input/view-gestures"

/** How long, in milliseconds, a point of the trail stays before it is gone. */
const TRAIL_LIFE = 180
/** The trail's width at the pen, in CSS pixels; it thins to nothing behind. */
const TRAIL_WIDTH = 8

type TrailPoint = { x: number; y: number; time: number }

/**
 * The trail as one closed outline: a ribbon whose width falls from the pen
 * back to nothing with each point's age, its sides drawn as curves through
 * the midpoints so a fast swipe, with its points far apart, still bends
 * smoothly, and a round end at the pen.
 */
function ribbon(points: readonly TrailPoint[], now: number): string {
  const live = points.filter(
    (p, i) => i === 0 || p.x !== points[i - 1].x || p.y !== points[i - 1].y
  )
  if (live.length < 2) return ""
  const left: [number, number][] = []
  const right: [number, number][] = []
  live.forEach((point, i) => {
    const before = live[Math.max(0, i - 1)]
    const after = live[Math.min(live.length - 1, i + 1)]
    const dx = after.x - before.x
    const dy = after.y - before.y
    const length = Math.hypot(dx, dy) || 1
    const age = Math.min(1, (now - point.time) / TRAIL_LIFE)
    const half = (TRAIL_WIDTH / 2) * (1 - age)
    const nx = (-dy / length) * half
    const ny = (dx / length) * half
    left.push([point.x + nx, point.y + ny])
    right.push([point.x - nx, point.y - ny])
  })
  const side = (edge: [number, number][]) => {
    let d = ""
    for (let i = 1; i < edge.length - 1; i++) {
      const [x, y] = edge[i]
      const [nx, ny] = edge[i + 1]
      d += ` Q${x.toFixed(1)},${y.toFixed(1)} ${((x + nx) / 2).toFixed(1)},${((y + ny) / 2).toFixed(1)}`
    }
    const [lx, ly] = edge[edge.length - 1]
    return d + ` L${lx.toFixed(1)},${ly.toFixed(1)}`
  }
  const head = live[live.length - 1]
  const age = Math.min(1, (now - head.time) / TRAIL_LIFE)
  const r = ((TRAIL_WIDTH / 2) * (1 - age)).toFixed(1)
  const [sx, sy] = left[0]
  return (
    `M${sx.toFixed(1)},${sy.toFixed(1)}` +
    side(left) +
    ` A${r},${r} 0 0 1 ${right[right.length - 1][0].toFixed(1)},${right[right.length - 1][1].toFixed(1)}` +
    side(right.reverse()) +
    " Z"
  )
}

/**
 * A short fading trail behind the eraser while it is down, as tldraw and
 * Excalidraw draw one, so the artist sees where it has been: an eraser
 * leaves nothing of its own to look at, only what it took. It follows the
 * pointer on the screen, drawn straight into the SVG each frame rather than
 * through React, and never reaches the artwork.
 */
export function EraserTrail({
  canvas,
  active,
}: {
  canvas: HTMLCanvasElement | null
  /** Whether the eraser is the tool in the hand. */
  active: boolean
}) {
  const group = useRef<SVGPathElement>(null)
  useEffect(() => {
    const trail = group.current
    if (!canvas || !trail || !active) return
    const points: TrailPoint[] = []
    let down: number | null = null
    let frame = 0

    const draw = () => {
      frame = 0
      const now = performance.now()
      while (points.length && now - points[0].time > TRAIL_LIFE) points.shift()
      trail.setAttribute("d", ribbon(points, now))
      if (points.length > 0) frame = requestAnimationFrame(draw)
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(draw)
    }
    const add = (event: PointerEvent) => {
      const events = event.getCoalescedEvents?.() ?? []
      for (const each of events.length ? events : [event])
        points.push({
          x: each.clientX,
          y: each.clientY,
          time: performance.now(),
        })
      schedule()
    }
    const begin = (event: PointerEvent) => {
      if (down !== null || isViewPanButton(event) || event.button !== 0) return
      down = event.pointerId
      points.length = 0
      add(event)
    }
    const move = (event: PointerEvent) => {
      if (event.pointerId === down) add(event)
    }
    // The trail is left to fade on its own once the pen lifts.
    const end = (event: PointerEvent) => {
      if (event.pointerId === down) down = null
    }
    canvas.addEventListener("pointerdown", begin)
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", end)
    window.addEventListener("pointercancel", end)
    return () => {
      canvas.removeEventListener("pointerdown", begin)
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", end)
      window.removeEventListener("pointercancel", end)
      cancelAnimationFrame(frame)
      trail.setAttribute("d", "")
    }
  }, [canvas, active])

  return (
    <svg
      aria-hidden
      data-testid="eraser-trail"
      className="pointer-events-none fixed inset-0 size-full"
    >
      {/* One shape at one opacity: overlapping translucent pieces would
          darken where they meet and read as a string of beads. */}
      <path
        ref={group}
        className="fill-neutral-500/30 dark:fill-neutral-400/30"
      />
    </svg>
  )
}
