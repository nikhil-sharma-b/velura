import type { Brush } from "./brush"
import type { Modulator } from "./dynamics"
import { CHARCOAL_TIP, GRAPHITE_TIP, PAPER_GRAIN } from "./texture"

/**
 * The brushes every install opens with (25): enough media to start painting
 * without configuring anything.
 *
 * Each one is a `Brush` and nothing else — the same data an artist's own
 * brushes are — so a built-in has no powers a saved one lacks and the library
 * needs no second code path to show it. What separates them is only where they
 * are kept: these are in the binary, so they cannot be deleted, and a change
 * to one is saved as a copy (see `features/studio/lib/brush-shelf.ts`).
 *
 * Every preset carries dynamics. A set of built-ins that were flat parameter
 * dumps would make the graph of ticket 05 look like an advanced feature rather
 * than what actually separates these media from each other: what makes the
 * pencil a pencil is that pressure reaches its flow and tilt reaches its size,
 * not that it names a speckled tip.
 */

/** The prefix every built-in id carries, so its origin is legible in a row. */
export const BUILTIN_BRUSH_PREFIX = "builtin:"

export function isBuiltinBrush(id: string): boolean {
  return id.startsWith(BUILTIN_BRUSH_PREFIX)
}

/** Pressure through the default linear curve, onto a scaled target. */
function scaledBy(
  source: Modulator["source"],
  target: Modulator["target"],
  low: number,
  high: number
): Modulator {
  return { source, target, range: [low, high], mix: "multiply" }
}

function offsetBy(
  source: Modulator["source"],
  target: Modulator["target"],
  low: number,
  high: number
): Modulator {
  return { source, target, range: [low, high], mix: "add" }
}

export const BUILTIN_BRUSHES: readonly Brush[] = Object.freeze([
  {
    id: `${BUILTIN_BRUSH_PREFIX}pencil`,
    name: "Pencil",
    shape: {
      radius: 3,
      feather: 0.5,
      roundness: 1,
      angle: 0,
      spacing: 0.08,
      tipTextureId: GRAPHITE_TIP,
    },
    grain: { textureId: PAPER_GRAIN, scale: 0.45, depth: 0.8, movement: 0 },
    // Dry media build: going over a line twice is how a pencil darkens.
    rendering: { accumulation: "buildup", opacity: 1, flow: 0.35 },
    dynamics: [
      // A pencil barely changes width with force; what it changes is how much
      // graphite it leaves, which is flow against the paper's tooth.
      scaledBy("pressure", "flow", 0.15, 1),
      scaledBy("pressure", "size", 0.75, 1),
      scaledBy("pressure", "grainDepth", 1, 0.55),
      // Laid over: the side of the lead covers more paper and bites less.
      scaledBy("tilt", "size", 1, 2.2),
      scaledBy("tilt", "roundness", 1, 0.55),
      // The lead follows the hand, so the flat of it faces the lean.
      offsetBy("tiltDirection", "angle", 0, 1),
    ],
  },
  {
    id: `${BUILTIN_BRUSH_PREFIX}charcoal`,
    name: "Charcoal",
    shape: {
      radius: 9,
      feather: 1.5,
      roundness: 0.85,
      angle: 0,
      spacing: 0.06,
      tipTextureId: CHARCOAL_TIP,
    },
    grain: { textureId: PAPER_GRAIN, scale: 0.8, depth: 0.75, movement: 0 },
    rendering: { accumulation: "buildup", opacity: 1, flow: 0.65 },
    dynamics: [
      scaledBy("pressure", "flow", 0.1, 1),
      scaledBy("pressure", "size", 0.6, 1.15),
      scaledBy("tilt", "size", 1, 2.6),
      // A stick shed on paper never lands the same way twice.
      offsetBy("random", "angle", 0, 1),
      scaledBy("random", "size", 0.85, 1.15),
    ],
  },
  {
    id: `${BUILTIN_BRUSH_PREFIX}ink`,
    name: "Inking pen",
    shape: { radius: 4, feather: 0.2, roundness: 1, angle: 0, spacing: 0.05 },
    // One flat mark however often the nib crosses itself.
    rendering: { accumulation: "coverage", opacity: 1, flow: 1 },
    dynamics: [
      // The line the whole tool exists for: force alone owns the width.
      scaledBy("pressure", "size", 0.1, 1),
      // A fast flick tapers, as a nib starved of contact does.
      scaledBy("velocity", "size", 1, 0.55),
    ],
  },
  {
    id: `${BUILTIN_BRUSH_PREFIX}round`,
    name: "Round brush",
    shape: { radius: 12, feather: 1.5, roundness: 1, angle: 0, spacing: 0.05 },
    grain: { textureId: PAPER_GRAIN, scale: 0.6, depth: 0.3, movement: 0 },
    rendering: { accumulation: "buildup", opacity: 1, flow: 0.45 },
    dynamics: [
      scaledBy("pressure", "size", 0.25, 1),
      scaledBy("pressure", "flow", 0.35, 1),
      // Pushed fast, a loaded brush lays down less than it does dwelling.
      scaledBy("velocity", "flow", 1, 0.7),
    ],
  },
  {
    id: `${BUILTIN_BRUSH_PREFIX}airbrush`,
    name: "Airbrush",
    // Wide falloff and low flow: an airbrush is built out of overlap.
    shape: { radius: 28, feather: 28, roundness: 1, angle: 0, spacing: 0.04 },
    rendering: { accumulation: "buildup", opacity: 0.85, flow: 0.06 },
    dynamics: [
      // The trigger meters paint, not the size of the cone.
      scaledBy("pressure", "flow", 0.08, 1),
      scaledBy("pressure", "size", 0.8, 1),
    ],
  },
  {
    id: `${BUILTIN_BRUSH_PREFIX}marker`,
    name: "Marker",
    // A chisel nib: flat, held at an angle, and that is its whole character.
    shape: {
      radius: 10,
      feather: 0.3,
      roundness: 0.3,
      angle: 0.125,
      spacing: 0.04,
    },
    rendering: { accumulation: "coverage", opacity: 0.85, flow: 1 },
    dynamics: [
      // Felt gives a little, so pressure widens the stroke rather than
      // darkening it — a marker crossing itself must stay one flat mark.
      scaledBy("pressure", "size", 0.8, 1.15),
      scaledBy("pressure", "opacity", 0.7, 1),
    ],
  },
])

/**
 * What a session with no remembered brush opens in the hand: a mid-sized round
 * brush that responds to pressure, which is the least surprising thing to find
 * on the end of the pen (`features/studio/components/canvas-host.tsx`).
 */
export const DEFAULT_LIBRARY_BRUSH_ID = `${BUILTIN_BRUSH_PREFIX}round`

export function builtinBrush(id: string): Brush | undefined {
  return BUILTIN_BRUSHES.find((brush) => brush.id === id)
}
