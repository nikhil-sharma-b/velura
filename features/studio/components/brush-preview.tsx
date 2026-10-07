"use client"

import { useEffect, useRef } from "react"

import type { Brush } from "@/engine/brush/brush"
import { GRAIN_CUT } from "@/engine/shaders/stamp"

import { previewStroke } from "../lib/brush-preview"

/**
 * Thumbnails drawn once per brush, box, density and ink colour. Keyed weakly on
 * the brush object: built-ins are frozen constants and a saved brush keeps its
 * object until its row changes, so a changed brush is a new key and a dropped
 * one is collected. This is what lets a library of 60+ rows scroll, and
 * re-open, without laying out every stroke again.
 */
const thumbnails = new WeakMap<Brush, Map<string, HTMLCanvasElement>>()

/**
 * The live preview stroke of the brush editor (D32).
 *
 * A 2D canvas, deliberately. The stroke it draws is computed by
 * `previewStroke` from the dynamics graph, so what the artist watches change
 * under a slider is the same evaluation the engine will run per dab — but it
 * costs no GPU work, holds no device, and cannot be disturbed by, or disturb,
 * the document being painted. Being a picture of the parameters rather than a
 * second renderer is what makes it honest about its own limits: the tip
 * texture and the paper's bite belong to the canvas.
 */
export function BrushPreview({
  brush,
  className,
  cached = false,
}: {
  brush: Brush
  className?: string
  /**
   * Reuse a stroke already drawn for this brush. For library rows, whose
   * brushes do not change under them; the editor's live preview leaves it off.
   */
  cached?: boolean
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const draw = () => {
      const bounds = canvas.getBoundingClientRect()
      const box = {
        width: Math.max(1, Math.round(bounds.width)),
        height: Math.max(1, Math.round(bounds.height)),
      }
      const density = window.devicePixelRatio || 1
      canvas.width = Math.round(box.width * density)
      canvas.height = Math.round(box.height * density)
      const ink = canvas.getContext("2d")
      if (!ink) return
      ink.setTransform(density, 0, 0, density, 0, 0)
      ink.clearRect(0, 0, box.width, box.height)
      const foreground = getComputedStyle(canvas).color
      const key = `${canvas.width}x${canvas.height}:${density}:${foreground}`
      const hit = cached ? thumbnails.get(brush)?.get(key) : undefined
      if (hit) {
        ink.setTransform(1, 0, 0, 1, 0, 0)
        ink.drawImage(hit, 0, 0)
        return
      }
      const preview = previewStroke(brush, box)
      ink.globalAlpha = preview.opacity
      // The stroke goes down as one layer and is composited once, which is
      // what stroke opacity means (D27): dabs drawn straight onto the canvas
      // at stroke opacity would darken wherever they overlap.
      const buffer = document.createElement("canvas")
      buffer.width = canvas.width
      buffer.height = canvas.height
      const layer = buffer.getContext("2d")
      if (!layer) return
      layer.setTransform(density, 0, 0, density, 0, 0)
      layer.fillStyle = foreground
      // Coverage takes the maximum, buildup accumulates — the same choice the
      // stroke buffer makes, in the nearest 2D equivalent each has.
      layer.globalCompositeOperation =
        preview.accumulation === "coverage" ? "lighten" : "source-over"
      // Grain is a surface, not a dab, and this canvas has no paper texture to
      // sample. What it can say honestly is how much of the mark the paper
      // takes away: the shader raises a threshold of `depth * GRAIN_CUT` that
      // the tooth has to clear, so a deeply grained brush reads here as the
      // thinner mark it becomes there — without pretending to show the tooth.
      const bite = 1 - preview.grainDepth * GRAIN_CUT
      for (const dab of preview.dabs) {
        layer.globalAlpha = Math.max(0, Math.min(1, dab.opacity * bite))
        layer.save()
        layer.translate(dab.x, dab.y)
        layer.rotate(dab.angle * Math.PI * 2)
        layer.scale(1, dab.roundness)
        layer.beginPath()
        layer.arc(0, 0, Math.max(0.25, dab.radius), 0, Math.PI * 2)
        layer.fill()
        layer.restore()
      }
      ink.drawImage(buffer, 0, 0, box.width, box.height)
      if (cached) {
        // The finished picture, stroke opacity included, so a hit is one copy.
        const snapshot = document.createElement("canvas")
        snapshot.width = canvas.width
        snapshot.height = canvas.height
        snapshot.getContext("2d")?.drawImage(canvas, 0, 0)
        const sizes = thumbnails.get(brush) ?? new Map()
        sizes.set(key, snapshot)
        thumbnails.set(brush, sizes)
      }
    }
    draw()
    // The box is what the stroke is laid out in, so a panel that resizes
    // redraws rather than stretching a stale picture.
    const observer = new ResizeObserver(draw)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [brush, cached])

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label="Brush preview stroke"
      data-testid="brush-preview"
      className={className}
    />
  )
}
