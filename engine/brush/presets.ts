import type { Brush } from "./brush"
import type { Modulator } from "./dynamics"
import { type BuiltinBrushSet, KRITA_BRUSHES } from "./krita-presets"
import { CHARCOAL_TIP, GRAPHITE_TIP, PAPER_GRAIN } from "./texture"

/**
 * The dry brushes every install opens with (25): enough media to start painting
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

/** A bristle tip from the bundled Krita resources: a loaded head of hairs. */
const OIL_BRISTLE_TIP = "krita:oil-bristle"
/** Hairs that have parted into clumps, as a brush short of paint does. */
const DRY_BRISTLE_TIP = "krita:bristles-grouped"
/** Woven canvas, from the same bundle. */
const CANVAS_GRAIN = "krita:01-canvas"

/**
 * The wet brushes every install opens with (live brushes 08): enough to paint
 * wet without building a brush first.
 *
 * Each is the same `Brush` data as the dry ones, with `rendering.wet` set, so
 * it lays its colour by `flow` and drags what is under it by `pickup` (D41).
 * The stroke opacity and accumulation they carry are what the brush goes back
 * to if wet is turned off in the editor. None scatters or jitters its colour:
 * neither reaches a wet dab yet.
 *
 * Pickup is small where the brush is meant to cover. The bristles are loaded
 * once, at pen-down, and every dab trades some of that load for what is under
 * it, so a brush that picked up a tenth per dab would be painting with the
 * canvas's colour within a few diameters.
 */
export const WET_BRUSHES: readonly Brush[] = Object.freeze([
  {
    id: `${BUILTIN_BRUSH_PREFIX}oil-round`,
    name: "Oil round",
    shape: { radius: 14, feather: 4, roundness: 1, angle: 0, spacing: 0.08 },
    // A loaded brush: it covers, and softens what it crosses on the way.
    rendering: {
      accumulation: "buildup",
      opacity: 1,
      flow: 0.8,
      wet: { pickup: 0.05 },
    },
    dynamics: [
      // A light touch blends and a hard press covers.
      scaledBy("pressure", "flow", 0.25, 1),
      scaledBy("pressure", "size", 0.6, 1),
    ],
  },
  {
    id: `${BUILTIN_BRUSH_PREFIX}oil-flat`,
    name: "Oil flat",
    shape: {
      radius: 18,
      feather: 0,
      roundness: 1,
      angle: 0,
      spacing: 0.06,
      tipTextureId: OIL_BRISTLE_TIP,
    },
    rendering: {
      accumulation: "buildup",
      opacity: 1,
      flow: 0.7,
      wet: { pickup: 0.04 },
    },
    dynamics: [
      // Turned with the stroke, the hairs always trail the way it is pulled,
      // and their streaks run along it.
      offsetBy("direction", "angle", 0, 1),
      scaledBy("pressure", "flow", 0.35, 1),
    ],
  },
  {
    id: `${BUILTIN_BRUSH_PREFIX}blender`,
    name: "Blender",
    shape: { radius: 16, feather: 6, roundness: 1, angle: 0, spacing: 0.08 },
    // Flow zero: it lays nothing, and only moves what is already there.
    rendering: {
      accumulation: "buildup",
      opacity: 1,
      flow: 0,
      wet: { pickup: 0.8 },
    },
    dynamics: [
      // Force is how far the paint is dragged, never how much is added.
      scaledBy("pressure", "pickup", 0.3, 1),
      scaledBy("pressure", "size", 0.7, 1),
    ],
  },
  {
    id: `${BUILTIN_BRUSH_PREFIX}dry-bristle`,
    name: "Dry bristle",
    shape: {
      radius: 16,
      feather: 0,
      roundness: 1,
      angle: 0,
      spacing: 0.06,
      tipTextureId: DRY_BRISTLE_TIP,
    },
    grain: { textureId: CANVAS_GRAIN, scale: 0.6, depth: 0.4, movement: 0 },
    // Nearly out of paint: it gives up its load early, and what it leaves
    // after that is mostly what it found.
    rendering: {
      accumulation: "buildup",
      opacity: 1,
      flow: 0.35,
      wet: { pickup: 0.2 },
    },
    dynamics: [
      // The hairs trail behind the hand, so their streaks run with the stroke.
      offsetBy("direction", "angle", 0, 1),
      scaledBy("pressure", "flow", 0.3, 1),
      // Pressed, the bristles reach into the weave.
      scaledBy("pressure", "grainDepth", 1, 0.5),
    ],
  },
])

/** The wet brushes as the library shelves them, after the dry built-ins. */
export const WET_BRUSH_SET: BuiltinBrushSet = Object.freeze({
  name: "Wet",
  brushes: WET_BRUSHES,
})

/**
 * What a session with no remembered brush opens in the hand: a fine pencil
 * that responds to pressure and tilt, which is the least surprising thing to
 * find on the end of the pen (`features/studio/components/canvas-host.tsx`).
 */
export const DEFAULT_LIBRARY_BRUSH_ID = `${BUILTIN_BRUSH_PREFIX}pencil`

const ALL_BUILTIN_BRUSHES = [
  ...BUILTIN_BRUSHES,
  ...WET_BRUSHES,
  ...KRITA_BRUSHES,
]

export function builtinBrush(id: string): Brush | undefined {
  return ALL_BUILTIN_BRUSHES.find((brush) => brush.id === id)
}
