/**
 * Navigation input: the trackpad, the mouse and the fingers (D28).
 *
 * The pen belongs to the stroke pipeline and is captured elsewhere. What is
 * here is everything that moves the *view* rather than the paint: the wheel,
 * a trackpad pinch (which the platform reports as a wheel with the control
 * modifier), a two-finger pan, pinch and twist on a touch screen, and a drag
 * with the middle mouse button, which is the mouse's own pan.
 *
 * The maths is separated from the listeners so that what a gesture means can
 * be tested without a browser, which is the part that is easy to get subtly
 * wrong — a zoom that drifts, or a twist read as a pan.
 */

import type { Point } from "../view/view-transform"

/** The two fingers of a gesture, in canvas CSS pixels. */
export type TouchPair = Readonly<{ a: Point; b: Point }>

/** What one step of a two-finger gesture asks of the view. */
export type GestureChange = Readonly<{
  /** Movement of the fingers' centre, in CSS pixels. */
  panDx: number
  panDy: number
  /** How much the spread grew, as a multiplier. */
  zoomFactor: number
  /** How far the fingers turned, in radians, clockwise. */
  rotation: number
  /** The centre the zoom is about: the point between the fingers. */
  anchorX: number
  anchorY: number
}>

/** What one wheel event asks of the view: a scroll, or a pinch-zoom. */
export type WheelChange = Readonly<{
  kind: "pan" | "zoom"
  panDx: number
  panDy: number
  zoomFactor: number
}>

/** A line of wheel travel, in pixels, for a wheel that reports lines. */
const LINE_HEIGHT = 16
/** A page of wheel travel, for the rare wheel that reports pages. */
const PAGE_HEIGHT = 400
/** How hard a pinch bites: chosen so a trackpad pinch feels one-to-one. */
const WHEEL_ZOOM_RATE = 0.01
/** The most one event may zoom by, so a flick cannot fly off the canvas. */
const MAX_WHEEL_FACTOR = 4

function wheelPixels(delta: number, mode: number | undefined): number {
  if (mode === 1) return delta * LINE_HEIGHT
  if (mode === 2) return delta * PAGE_HEIGHT
  return delta
}

/**
 * Reads one wheel event. The control modifier is what a trackpad pinch
 * arrives as on every platform, so it is the pinch and not a shortcut.
 */
export function wheelChange(event: {
  deltaX: number
  deltaY: number
  ctrlKey: boolean
  metaKey?: boolean
  deltaMode?: number
}): WheelChange {
  const dx = wheelPixels(event.deltaX, event.deltaMode)
  const dy = wheelPixels(event.deltaY, event.deltaMode)
  if (event.ctrlKey || event.metaKey) {
    const factor = Math.exp(-dy * WHEEL_ZOOM_RATE)
    return {
      kind: "zoom",
      panDx: 0,
      panDy: 0,
      zoomFactor: Math.min(
        MAX_WHEEL_FACTOR,
        Math.max(1 / MAX_WHEEL_FACTOR, factor)
      ),
    }
  }
  // Scrolling down moves the canvas up, the way a document scrolls.
  return { kind: "pan", panDx: -dx, panDy: -dy, zoomFactor: 1 }
}

const centre = (pair: TouchPair) => ({
  x: (pair.a.x + pair.b.x) / 2,
  y: (pair.a.y + pair.b.y) / 2,
})

const spread = (pair: TouchPair) =>
  Math.hypot(pair.b.x - pair.a.x, pair.b.y - pair.a.y)

const bearing = (pair: TouchPair) =>
  Math.atan2(pair.b.y - pair.a.y, pair.b.x - pair.a.x)

/**
 * What the fingers did between two frames: moved, spread, and turned. All
 * three at once, because a real gesture is never only one of them and
 * quantising it into modes is what makes a canvas feel stuck.
 */
export function gestureChange(from: TouchPair, to: TouchPair): GestureChange {
  const before = centre(from)
  const after = centre(to)
  const wasApart = spread(from)
  const isApart = spread(to)
  // Two fingers reported at the same point have no spread and no bearing, so
  // this step is a pan and the next one, once they separate, is not.
  const scalable = wasApart > 0 && isApart > 0
  return {
    panDx: after.x - before.x,
    panDy: after.y - before.y,
    zoomFactor: scalable ? isApart / wasApart : 1,
    rotation: scalable ? bearing(to) - bearing(from) : 0,
    anchorX: after.x,
    anchorY: after.y,
  }
}

export interface ViewGestureHandlers {
  /** Drag the canvas, in CSS pixels. */
  pan(dx: number, dy: number): void
  /** Multiply the zoom, holding a point in canvas CSS pixels still. */
  zoom(factor: number, anchor: Point): void
  /** Turn the canvas by a delta, without snapping: a twist is continuous. */
  rotate(radians: number): void
  /**
   * A second finger landed. Painting and navigating are different acts, so
   * the mark the first finger started is taken back rather than left as a
   * stray dot in the middle of a pinch.
   */
  cancelStroke(): void
}

/**
 * Listens for navigation on a canvas. Returns the detach.
 *
 * Touches are tracked here rather than through the stroke sampler because a
 * gesture is about a *pair* of pointers, and the sampler is deliberately
 * about one: the pen.
 */
export function attachViewGestures(
  canvas: HTMLCanvasElement,
  handlers: ViewGestureHandlers
): () => void {
  const touches = new Map<number, Point>()
  let gesture: TouchPair | null = null
  // The middle button held down, and where it last was: the mouse's pan.
  let dragging: Point | null = null
  let originX = 0
  let originY = 0

  function measure() {
    const bounds = canvas.getBoundingClientRect()
    originX = bounds.left
    originY = bounds.top
  }

  const local = (event: PointerEvent): Point => ({
    x: event.clientX - originX,
    y: event.clientY - originY,
  })

  /** The two oldest touches down: a third finger does not hijack the gesture. */
  function pairOf(): TouchPair | null {
    const points = [...touches.values()]
    return points.length >= 2 ? { a: points[0], b: points[1] } : null
  }

  function onPointerDown(event: PointerEvent) {
    // The middle button is nobody's brush, so it is free to be the pan that a
    // mouse otherwise has no gesture for.
    if (event.button === 1) {
      event.preventDefault()
      dragging = local(event)
      canvas.setPointerCapture(event.pointerId)
      return
    }
    if (event.pointerType !== "touch") return
    if (touches.size === 0) measure()
    touches.set(event.pointerId, local(event))
    const pair = pairOf()
    if (pair && !gesture) {
      gesture = pair
      handlers.cancelStroke()
    }
  }

  function onPointerMove(event: PointerEvent) {
    if (dragging) {
      const at = local(event)
      handlers.pan(at.x - dragging.x, at.y - dragging.y)
      dragging = at
      return
    }
    if (!touches.has(event.pointerId)) return
    touches.set(event.pointerId, local(event))
    const pair = pairOf()
    if (!pair || !gesture) return
    event.preventDefault()
    const change = gestureChange(gesture, pair)
    gesture = pair
    handlers.pan(change.panDx, change.panDy)
    if (change.zoomFactor !== 1)
      handlers.zoom(change.zoomFactor, { x: change.anchorX, y: change.anchorY })
    if (change.rotation !== 0) handlers.rotate(change.rotation)
  }

  function onPointerFinish(event: PointerEvent) {
    dragging = null
    if (!touches.delete(event.pointerId)) return
    // Lifting one finger of a pinch must not fling the canvas: the gesture
    // restarts from wherever the remaining fingers are.
    gesture = pairOf()
  }

  function onWheel(event: WheelEvent) {
    event.preventDefault()
    const change = wheelChange(event)
    if (change.kind === "zoom")
      handlers.zoom(change.zoomFactor, {
        x: event.clientX - originX,
        y: event.clientY - originY,
      })
    else handlers.pan(change.panDx, change.panDy)
  }

  // Measured on attach and whenever the page could have moved the canvas,
  // never per event: a trackpad pinch fires several wheel events a frame, and
  // reading layout in each of them forces that many reflows.
  measure()
  const onLayoutChange = () => measure()
  window.addEventListener("resize", onLayoutChange)
  window.addEventListener("scroll", onLayoutChange, true)
  canvas.addEventListener("pointerdown", onPointerDown)
  canvas.addEventListener("pointermove", onPointerMove)
  canvas.addEventListener("pointerup", onPointerFinish)
  canvas.addEventListener("pointercancel", onPointerFinish)
  canvas.addEventListener("wheel", onWheel, { passive: false })

  return () => {
    touches.clear()
    gesture = null
    window.removeEventListener("resize", onLayoutChange)
    window.removeEventListener("scroll", onLayoutChange, true)
    canvas.removeEventListener("pointerdown", onPointerDown)
    canvas.removeEventListener("pointermove", onPointerMove)
    canvas.removeEventListener("pointerup", onPointerFinish)
    canvas.removeEventListener("pointercancel", onPointerFinish)
    canvas.removeEventListener("wheel", onWheel)
  }
}
