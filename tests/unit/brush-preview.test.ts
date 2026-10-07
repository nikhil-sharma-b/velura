import { describe, expect, test } from "bun:test"

import { type Brush, DEFAULT_BRUSH } from "../../engine/brush/brush"
import type { Modulator } from "../../engine/brush/dynamics"
import { previewStroke } from "../../features/studio/lib/brush-preview"

const BOX = { width: 200, height: 80 }

function brush(overrides: Partial<Brush> = {}): Brush {
  return { ...structuredClone(DEFAULT_BRUSH), ...overrides }
}

describe("the brush editor's preview stroke", () => {
  test("lays dabs along the box at the brush's own spacing", () => {
    const preview = previewStroke(brush(), BOX)
    expect(preview.dabs.length).toBeGreaterThan(10)
    for (const dab of preview.dabs) {
      expect(dab.x).toBeGreaterThanOrEqual(0)
      expect(dab.x).toBeLessThanOrEqual(BOX.width)
      expect(dab.y).toBeGreaterThanOrEqual(0)
      expect(dab.y).toBeLessThanOrEqual(BOX.height)
    }
    // The stroke travels left to right, so the dabs are laid in that order.
    const xs = preview.dabs.map((dab) => dab.x)
    expect([...xs].sort((a, b) => a - b)).toEqual(xs)
    const gaps = preview.dabs
      .slice(1)
      .map((dab, index) =>
        Math.hypot(dab.x - preview.dabs[index].x, dab.y - preview.dabs[index].y)
      )
    // Even spacing along the path's length; the slack is the chord error of
    // walking a curve as a polyline, not a difference an eye could find.
    for (const gap of gaps) expect(gap).toBeCloseTo(gaps[0], 2)
  })

  test("wider spacing means fewer dabs over the same path", () => {
    const dense = previewStroke(brush(), BOX).dabs.length
    const sparse = previewStroke(
      brush({ shape: { ...DEFAULT_BRUSH.shape, spacing: 1 } }),
      BOX
    ).dabs.length
    expect(sparse).toBeLessThan(dense)
  })

  test("an unmodulated brush draws every dab at its own radius", () => {
    const preview = previewStroke(brush(), BOX)
    for (const dab of preview.dabs)
      expect(dab.radius).toBeCloseTo(DEFAULT_BRUSH.shape.radius, 6)
  })

  test("pressure on size tapers the stroke at both ends", () => {
    const pressureSize: Modulator = {
      source: "pressure",
      target: "size",
      range: [0, 1],
      mix: "multiply",
    }
    const preview = previewStroke(brush({ dynamics: [pressureSize] }), BOX)
    const radii = preview.dabs.map((dab) => dab.radius)
    const middle = radii[Math.floor(radii.length / 2)]
    expect(radii[0]).toBeLessThan(middle)
    expect(radii.at(-1)!).toBeLessThan(middle)
    expect(middle).toBeCloseTo(DEFAULT_BRUSH.shape.radius, 1)
  })

  test("a dab never grows past the box it is previewed in", () => {
    const preview = previewStroke(
      brush({ shape: { ...DEFAULT_BRUSH.shape, radius: 400 } }),
      BOX
    )
    for (const dab of preview.dabs)
      expect(dab.radius).toBeLessThanOrEqual(BOX.height / 2)
  })

  test("carries the stroke's own opacity and accumulation, not the dab's", () => {
    const preview = previewStroke(
      brush({
        rendering: { accumulation: "buildup", opacity: 0.4, flow: 0.5 },
      }),
      BOX
    )
    expect(preview.opacity).toBeCloseTo(0.4, 6)
    expect(preview.accumulation).toBe("buildup")
    for (const dab of preview.dabs) expect(dab.opacity).toBeCloseTo(0.5, 6)
  })

  test("is the same stroke every time, so a redraw does not reshuffle it", () => {
    const speckle: Modulator = {
      source: "random",
      target: "flow",
      range: [0.2, 1],
      mix: "multiply",
    }
    const first = previewStroke(brush({ dynamics: [speckle] }), BOX)
    const second = previewStroke(brush({ dynamics: [speckle] }), BOX)
    expect(second.dabs).toEqual(first.dabs)
    // Randomness is a real input, so it has to change something.
    const plain = previewStroke(brush(), BOX)
    expect(second.dabs).not.toEqual(plain.dabs)
  })

  test("a scatter mapping without a scatter amount moves nothing", () => {
    // The target scales the brush's own amount, and a brush made before
    // scatter existed has none: it draws as it always did.
    const mapped = previewStroke(
      brush({
        dynamics: [
          {
            source: "random",
            target: "scatter",
            range: [0, 4],
            mix: "multiply",
          },
        ],
      }),
      BOX
    )
    expect(mapped.dabs).toEqual(previewStroke(brush(), BOX).dabs)
  })

  test("scatter throws dabs off the path, count of them per step", () => {
    const plain = previewStroke(brush(), BOX)
    const scattered = previewStroke(
      brush({ scatter: { amount: 2, count: 3, axes: "both" } }),
      BOX
    )
    expect(scattered.dabs.length).toBe(plain.dabs.length * 3)
    expect(scattered.dabs).not.toEqual(
      plain.dabs.flatMap((dab) => [dab, dab, dab])
    )
    // The same on every redraw, or the preview would shimmer under a slider.
    expect(
      previewStroke(
        brush({ scatter: { amount: 2, count: 3, axes: "both" } }),
        BOX
      ).dabs
    ).toEqual(scattered.dabs)
  })

  test("a brush with no grain previews with no bite", () => {
    expect(previewStroke(brush(), BOX).grainDepth).toBe(0)
    const grained = previewStroke(
      brush({
        grain: { textureId: "paper", scale: 1, depth: 0.8, movement: 0 },
      }),
      BOX
    )
    expect(grained.grainDepth).toBeCloseTo(0.8, 6)
  })
})
