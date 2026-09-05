import type { SampleBuffer } from "./sample-buffer"

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
  /** The pen went down, in canvas backing-store pixels. */
  begin(x: number, y: number, pressure: number): void
  /** The pen lifted or the stroke was cancelled. */
  end(): void
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

  function measure() {
    const bounds = canvas.getBoundingClientRect()
    originX = bounds.left
    originY = bounds.top
    // CSS pixels to backing-store pixels: the canvas is drawn at device
    // resolution, and strokes are authored in those same pixels.
    scaleX = bounds.width > 0 ? canvas.width / bounds.width : 1
    scaleY = bounds.height > 0 ? canvas.height / bounds.height : 1
  }

  function record(event: PointerEvent) {
    buffer.push(
      (event.clientX - originX) * scaleX,
      (event.clientY - originY) * scaleY,
      event.pressure
    )
  }

  function onPointerDown(event: PointerEvent) {
    if (activePointer !== null || !event.isPrimary) return
    activePointer = event.pointerId
    // Capture keeps the stroke alive when the pen leaves the canvas, so a
    // gesture that overshoots the edge still ends where the pen lifted.
    canvas.setPointerCapture(event.pointerId)
    measure()
    event.preventDefault()
    buffer.clear()
    handlers.begin(
      (event.clientX - originX) * scaleX,
      (event.clientY - originY) * scaleY,
      event.pressure
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
