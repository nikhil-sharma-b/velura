import type { SampleBuffer } from "./sample-buffer"
import { isViewPanButton } from "./view-gestures"

/**
 * Pointer capture for the stroke pipeline (D26).
 *
 * `pointerrawupdate` fires at the device's rate rather than once per frame,
 * and `getCoalescedEvents()` recovers every sample the browser batched. A
 * 240 Hz stylus reports roughly four positions per frame; reading only the
 * latest `pointermove` turns curves into polygons.
 *
 * Nothing is drawn here. Samples land in the ring buffer and the engine's
 * frame loop decides what to do with them, which is what keeps input capture
 * independent of the frame rate.
 */

export interface StrokeHandlers {
  /**
   * The pen went down, in canvas backing-store pixels. `time` is zero, since
   * every sample's clock is relative to this one; `origin` is that zero read
   * on the page's own clock, which is the only way anything downstream can
   * say how old a sample is now.
   */
  begin(
    x: number,
    y: number,
    pressure: number,
    tiltX: number,
    tiltY: number,
    time: number,
    origin: number
  ): void
  /** The pen lifted or the stroke was cancelled. */
  end(): void
  /** Samples the canvas instead of opening a stroke while Alt/Option is held. */
  sample?(x: number, y: number): void
}

/** Whether the browser reports raw pointer updates ahead of `pointermove`. */
const RAW_UPDATES = "onpointerrawupdate" in globalThis

export function attachPointerSampler(
  canvas: HTMLCanvasElement,
  buffer: SampleBuffer,
  handlers: StrokeHandlers
): () => void {
  let activePointer: number | null = null
  // Captured once per stroke: reading layout per event would force a reflow
  // several times a frame.
  let originX = 0
  let originY = 0
  let scaleX = 1
  let scaleY = 1
  // Timestamps are made relative to the pen going down. The document clock
  // runs to millions of milliseconds on a long session, and the ring stores
  // samples as float32: an absolute reading would lose the sub-millisecond
  // resolution that a velocity mapping is derived from.
  let strokeStart = 0

  function measure() {
    const bounds = canvas.getBoundingClientRect()
    originX = bounds.left
    originY = bounds.top
    // CSS pixels to backing-store pixels: the canvas is drawn at device
    // resolution, and strokes are authored in those same pixels.
    scaleX = bounds.width > 0 ? canvas.width / bounds.width : 1
    scaleY = bounds.height > 0 ? canvas.height / bounds.height : 1
  }

  const canvasX = (event: PointerEvent) => (event.clientX - originX) * scaleX
  const canvasY = (event: PointerEvent) => (event.clientY - originY) * scaleY

  /**
   * Force, or a full press from a device that cannot report one. Whether
   * there is a sensor is a fact about the device, so it is decided here and
   * once — a pen that genuinely reports zero as it lands must keep its zero,
   * or the taper a pressure mapping draws is inverted at both ends.
   */
  const canvasPressure = (event: PointerEvent) =>
    event.pointerType === "mouse" ? 1 : event.pressure

  function record(event: PointerEvent) {
    buffer.push(
      canvasX(event),
      canvasY(event),
      canvasPressure(event),
      event.tiltX,
      event.tiltY,
      event.timeStamp - strokeStart
    )
  }

  function onPointerDown(event: PointerEvent) {
    if (activePointer !== null || !event.isPrimary) return
    // No secondary mouse button paints; the barrel button is the equivalent
    // pen navigation input. Other pen buttons retain their device semantics.
    if (
      (event.pointerType === "mouse" && event.button !== 0) ||
      isViewPanButton(event)
    )
      return
    measure()
    if (event.altKey && handlers.sample) {
      event.preventDefault()
      handlers.sample(canvasX(event), canvasY(event))
      return
    }
    activePointer = event.pointerId
    // Capture keeps the stroke alive when the pen leaves the canvas, so a
    // gesture that overshoots the edge still ends where the pen lifted.
    // Capture throws for a pointer the browser no longer considers active,
    // and losing it is not a reason to lose the stroke: without it the stroke
    // simply ends where the pen leaves the canvas.
    try {
      canvas.setPointerCapture(event.pointerId)
    } catch {
      // Left uncaptured on purpose.
    }
    event.preventDefault()
    buffer.clear()
    strokeStart = event.timeStamp
    handlers.begin(
      canvasX(event),
      canvasY(event),
      canvasPressure(event),
      event.tiltX,
      event.tiltY,
      0,
      event.timeStamp
    )
  }

  function onPointerUpdate(event: PointerEvent) {
    if (event.pointerId !== activePointer) return
    event.preventDefault()
    // Coalesced events are the samples the browser withheld between frames.
    // The event itself is the last of them, so it is never read separately.
    const coalesced = event.getCoalescedEvents?.()
    if (coalesced && coalesced.length > 0)
      for (const sample of coalesced) record(sample)
    else record(event)
  }

  function onPointerFinish(event: PointerEvent) {
    if (event.pointerId !== activePointer) return
    activePointer = null
    if (event.type !== "pointercancel") record(event)
    handlers.end()
  }

  const updateEvent = RAW_UPDATES ? "pointerrawupdate" : "pointermove"
  canvas.addEventListener("pointerdown", onPointerDown)
  canvas.addEventListener(updateEvent, onPointerUpdate as EventListener)
  canvas.addEventListener("pointerup", onPointerFinish)
  canvas.addEventListener("pointercancel", onPointerFinish)

  return () => {
    if (activePointer !== null && canvas.hasPointerCapture(activePointer))
      canvas.releasePointerCapture(activePointer)
    activePointer = null
    canvas.removeEventListener("pointerdown", onPointerDown)
    canvas.removeEventListener(updateEvent, onPointerUpdate as EventListener)
    canvas.removeEventListener("pointerup", onPointerFinish)
    canvas.removeEventListener("pointercancel", onPointerFinish)
  }
}
