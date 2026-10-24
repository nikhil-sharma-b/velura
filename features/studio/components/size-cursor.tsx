"use client"

import { useEffect, useRef } from "react"

/**
 * A ring under the pointer as wide as the tool's dab lands, for a tool whose
 * size cannot be read off its own mark: smudge lays nothing down, so the ring
 * is the only place its size shows before the paint has moved. It is an
 * element rather than a CSS cursor because browsers refuse a cursor image
 * past about a hundred pixels, and a large smudge is larger than that.
 *
 * It follows the pointer on the screen, moved straight on the element rather
 * than through React, and never reaches the artwork.
 */
export function SizeCursor({
  canvas,
  active,
  radius,
  zoom,
}: {
  canvas: HTMLCanvasElement | null
  /** Whether the sized tool is the one in the hand. */
  active: boolean
  /** The dab's radius in document pixels. */
  radius: number
  /** Screen pixels per document pixel, in the canvas's own backing pixels. */
  zoom: number
}) {
  const ring = useRef<HTMLDivElement>(null)
  // Where the pointer last was over the canvas, kept across a change of size
  // so the ring is redrawn where it is rather than waiting for a move.
  const at = useRef<{ x: number; y: number } | null>(null)

  // Followed whatever the tool, so picking the sized one up by its key shows
  // the ring where the pointer already rests.
  useEffect(() => {
    if (!canvas) return
    const move = (event: PointerEvent) => {
      at.current = { x: event.clientX, y: event.clientY }
    }
    const leave = (event: PointerEvent) => {
      // A stroke that runs off the canvas still has the pointer captured.
      if (event.buttons === 0) at.current = null
    }
    canvas.addEventListener("pointermove", move)
    canvas.addEventListener("pointerdown", move)
    canvas.addEventListener("pointerleave", leave)
    return () => {
      canvas.removeEventListener("pointermove", move)
      canvas.removeEventListener("pointerdown", move)
      canvas.removeEventListener("pointerleave", leave)
    }
  }, [canvas])

  useEffect(() => {
    const element = ring.current
    if (!canvas || !element || !active) return
    const place = () => {
      const point = at.current
      if (!point) {
        element.style.display = "none"
        return
      }
      const bounds = canvas.getBoundingClientRect()
      // The view's zoom is in backing-store pixels; the ring is laid out in
      // CSS ones.
      const density = bounds.width > 0 ? canvas.width / bounds.width : 1
      const diameter = (radius * 2 * zoom) / density
      element.style.display = "block"
      element.style.width = `${diameter}px`
      element.style.height = `${diameter}px`
      element.style.transform = `translate(${point.x - diameter / 2}px, ${point.y - diameter / 2}px)`
    }
    // After the effect above has recorded where the pointer went: listeners
    // on one element run in the order they were added.
    place()
    canvas.addEventListener("pointermove", place)
    canvas.addEventListener("pointerdown", place)
    canvas.addEventListener("pointerleave", place)
    return () => {
      canvas.removeEventListener("pointermove", place)
      canvas.removeEventListener("pointerdown", place)
      canvas.removeEventListener("pointerleave", place)
      element.style.display = "none"
    }
  }, [canvas, active, radius, zoom])

  return (
    <div
      ref={ring}
      aria-hidden
      data-testid="size-cursor"
      // Dark under light, as the painting dot is, so the ring reads on white
      // paper and on the dark matting alike.
      className="pointer-events-none fixed top-0 left-0 hidden rounded-full border border-white shadow-[0_0_0_1px_rgb(24_24_27/0.5),inset_0_0_0_1px_rgb(24_24_27/0.5)]"
    />
  )
}
