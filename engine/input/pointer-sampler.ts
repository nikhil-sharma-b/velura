import type { Curve } from "../brush/curve"
import { tiltFromAltitude } from "../brush/stamp-context"
import { DEFAULT_PRESSURE_CURVE, shapePressure } from "./pressure-curve"
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
   * say how old a sample is now. `sensesPressure` says whether the device
   * has a force sensor at all, decided per stroke so that a tablet plugged in
   * mid-session is honoured from its first mark.
   */
  begin(
    x: number,
    y: number,
    pressure: number,
    tiltX: number,
    tiltY: number,
    time: number,
    origin: number,
    sensesPressure: boolean
  ): void
  /** The pen lifted or the stroke was cancelled. */
  end(): void
  /** Samples the canvas instead of opening a stroke while Alt/Option is held. */
  sample?(x: number, y: number): void
  /**
   * Whether Shift, Alt/Option and Ctrl are held, told as the pen goes down and with
   * every move, so a drag can be constrained mid-gesture and a selection
   * know how to combine.
   */
  modifiers?(shift: boolean, alt: boolean, ctrl: boolean): void
}

export interface SamplerOptions {
  /**
   * The artist's pen response curve, read per sample rather than captured, so
   * that changing it in settings takes effect on the next mark instead of on
   * the next time input happens to be reattached.
   */
  pressureCurve?: () => Curve
  /**
   * Whether the pen's tilt is read at all. Off, every sample reports an
   * upright pen — read per sample for the same reason the curve is, so the
   * switch takes effect on the next mark.
   */
  tiltEnabled?: () => boolean
  /**
   * Whether Alt/Option held as the pen goes down samples the canvas. Off, the
   * press opens a stroke and the key is only reported through `modifiers`.
   */
  altSamples?: () => boolean
}

/** Whether the browser reports raw pointer updates ahead of `pointermove`. */
const RAW_UPDATES = "onpointerrawupdate" in globalThis

export function attachPointerSampler(
  canvas: HTMLCanvasElement,
  buffer: SampleBuffer,
  handlers: StrokeHandlers,
  options: SamplerOptions = {}
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
   *
   * A device that reports force has the artist's response curve applied to it
   * here, at the one place a raw reading enters the pipeline, so that nothing
   * downstream — the ring buffer, the stroke path, a brush's own dynamics —
   * has to know which hand is holding the pen. A mouse is exempt: its 1 is a
   * stand-in for a missing sensor, not a press, and shaping it would let a
   * curve the artist drew for their pen quietly thin every mouse stroke.
   */
  // Only a pen is trusted to measure force: a mouse or trackpad has no sensor,
  // and a finger on glass reports a constant stand-in (0.5 by the spec's own
  // default) that would pin every pressure mapping partway up its range.
  const sensesPressure = (event: PointerEvent) => event.pointerType === "pen"
  const canvasPressure = (event: PointerEvent) =>
    !sensesPressure(event)
      ? 1
      : shapePressure(
          options.pressureCurve?.() ?? DEFAULT_PRESSURE_CURVE,
          event.pressure
        )

  /**
   * The pen's orientation as a pair of axis angles.
   *
   * A device need only report one of the two forms the spec defines, and
   * WebKit prefers the spherical one for Apple Pencil. The axis angles win
   * where a device gives them, because a browser that reports both has
   * already done this conversion; the fallback is read only from a pen that
   * says it is upright on both axes, where deriving it either recovers a real
   * lean or agrees with the zeroes it replaces.
   */
  function canvasTilt(event: PointerEvent): readonly [number, number] {
    // Switched off, the pen reads as upright rather than as untilted-and-
    // unknown: zero is what an upright pen genuinely reports, so a brush that
    // shades with tilt falls back to its own size instead of to nothing.
    if (options.tiltEnabled?.() === false) return [0, 0]
    if (event.tiltX || event.tiltY) return [event.tiltX, event.tiltY]
    if (event.altitudeAngle === undefined) return [0, 0]
    return tiltFromAltitude(event.altitudeAngle, event.azimuthAngle ?? 0)
  }

  function record(event: PointerEvent) {
    const [tiltX, tiltY] = canvasTilt(event)
    buffer.push(
      canvasX(event),
      canvasY(event),
      canvasPressure(event),
      tiltX,
      tiltY,
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
    if (event.altKey && handlers.sample && (options.altSamples?.() ?? true)) {
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
    handlers.modifiers?.(event.shiftKey, event.altKey, event.ctrlKey)
    strokeStart = event.timeStamp
    const [tiltX, tiltY] = canvasTilt(event)
    handlers.begin(
      canvasX(event),
      canvasY(event),
      canvasPressure(event),
      tiltX,
      tiltY,
      0,
      event.timeStamp,
      sensesPressure(event)
    )
  }

  function onPointerUpdate(event: PointerEvent) {
    if (event.pointerId !== activePointer) return
    event.preventDefault()
    handlers.modifiers?.(event.shiftKey, event.altKey, event.ctrlKey)
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
