"use client"

import { useEffect, useId, useRef } from "react"

import { encodeTransfer } from "@/engine/color/display-transform"
import { maxSrgbChroma, oklabToLinearSrgb } from "@/engine/color/oklch"

/**
 * Hue round the rim and saturation out from the centre, drawn at the
 * lightness the slider below holds. Saturation is the picker's own: a share
 * of the chroma each hue can hold at this lightness, so the rim is every hue
 * at its fullest and the wheel stays a disc rather than OKLCH's lopsided
 * gamut.
 *
 * Its thumb is a slider for the keyboard: left and right turn the hue, up
 * and down move out towards the rim and in towards grey.
 */
export function ColorWheel({
  lightness,
  hue,
  saturation,
  hex,
  onChange,
  onCommit,
}: {
  lightness: number
  hue: number
  saturation: number
  /** The colour at the thumb, which it is filled with. */
  hex: string
  onChange(next: { hue: number; saturation: number }): void
  onCommit(): void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const keysId = useId()

  // Redrawn only when lightness moves: hue and saturation are where the thumb
  // sits on the wheel, not what the wheel shows. One pixel per CSS pixel is
  // enough for a gradient this smooth, and keeps a lightness drag cheap.
  useEffect(() => {
    const canvas = canvasRef.current
    const ink = canvas?.getContext("2d")
    if (!canvas || !ink) return
    const size = canvas.width
    const radius = size / 2
    const ceiling = Array.from({ length: 360 }, (_, degree) =>
      maxSrgbChroma(lightness, degree)
    )
    const image = ink.createImageData(size, size)
    // Straight from Oklab to display sRGB: what the wheel shows is the sRGB
    // colour each point stands for, so the working space's round trip would
    // be thrown away, and per pixel it is most of the cost.
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = (x + 0.5 - radius) / radius
        const dy = (radius - y - 0.5) / radius
        const distance = Math.hypot(dx, dy) || 1e-9
        const degree = Math.floor(
          ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360
        )
        const chroma = Math.min(1, distance) * ceiling[degree]
        const rgb = oklabToLinearSrgb([
          lightness,
          (chroma * dx) / distance,
          (chroma * dy) / distance,
        ])
        const at = (y * size + x) * 4
        image.data[at] = encodeTransfer(rgb[0]) * 255
        image.data[at + 1] = encodeTransfer(rgb[1]) * 255
        image.data[at + 2] = encodeTransfer(rgb[2]) * 255
        image.data[at + 3] = 255
      }
    }
    ink.putImageData(image, 0, 0)
  }, [lightness])

  const pick = (event: React.PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    const radius = box.width / 2
    const dx = (event.clientX - box.left - radius) / radius
    const dy = (box.top + radius - event.clientY) / radius
    onChange({
      hue: ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360,
      saturation: Math.min(1, Math.hypot(dx, dy)),
    })
  }

  const step = (event: React.KeyboardEvent) => {
    const by = event.shiftKey ? 10 : 1
    const turn = { ArrowLeft: -by, ArrowRight: by }[event.key]
    const reach = { ArrowDown: -by, ArrowUp: by }[event.key]
    if (turn === undefined && reach === undefined) return
    event.preventDefault()
    onChange({
      hue: (hue + (turn ?? 0) + 360) % 360,
      saturation: Math.min(1, Math.max(0, saturation + (reach ?? 0) / 100)),
    })
  }

  const radians = (hue * Math.PI) / 180
  return (
    <div
      className="relative mx-auto aspect-square w-full max-w-56 touch-none"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        pick(event)
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) pick(event)
      }}
      onPointerUp={onCommit}
    >
      <canvas
        ref={canvasRef}
        width={224}
        height={224}
        aria-hidden
        className="size-full rounded-full border border-border/60"
      />
      <p id={keysId} className="sr-only">
        Left and right turn the hue; up and down change the saturation.
      </p>
      <div
        role="slider"
        tabIndex={0}
        aria-label="Hue"
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(hue)}
        aria-valuetext={`${Math.round(hue)}°, saturation ${Math.round(saturation * 100)}%`}
        aria-describedby={keysId}
        onKeyDown={step}
        onKeyUp={(event) => {
          if (event.key.startsWith("Arrow")) onCommit()
        }}
        className="absolute size-4 -translate-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.5)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        style={{
          left: `${50 + 50 * saturation * Math.cos(radians)}%`,
          top: `${50 - 50 * saturation * Math.sin(radians)}%`,
          backgroundColor: hex,
        }}
      />
    </div>
  )
}
