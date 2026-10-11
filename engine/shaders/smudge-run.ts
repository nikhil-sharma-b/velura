import template from "./smudge-run.wgsl"
import { pigmentShader } from "./pigment"
import { preprocess } from "./preprocess"

/**
 * Floats in one dab's block of the run's uniform buffer, which is the
 * alignment a dynamic offset must keep: `RunDab` below, and room to spare.
 */
export const RUN_DAB_FLOATS = 64

/** Where each of a dab's values sits in its block; `RunDab` in the shader. */
export const RUN_DAB = {
  VIEWPORT_X: 0,
  VIEWPORT_Y: 1,
  FEATHER: 2,
  USE_TIP: 3,
  CENTER_X: 4,
  CENTER_Y: 5,
  TRAVEL_X: 6,
  TRAVEL_Y: 7,
  RADIUS: 8,
  STRENGTH: 9,
  ANGLE: 10,
  ROUNDNESS: 11,
  TIP_FRAME: 12,
  USE_SELECTION: 13,
  REGION_X: 14,
  REGION_Y: 15,
  REGION_WIDTH: 16,
  REGION_HEIGHT: 17,
  CLIP_LEFT: 20,
  CLIP_TOP: 21,
  CLIP_RIGHT: 22,
  CLIP_BOTTOM: 23,
} as const

/** Bytes of a block the shader reads. */
export const RUN_DAB_BYTES = 96

/** Invocations to a side of one workgroup. */
export const RUN_WORKGROUP = 8

/**
 * A run of dragging dabs in one pass (live brushes 22). A render pass cannot
 * read what it writes, so a dab drawn into the layer is a copy and a pass of
 * its own; a compute pass may read one texture and write another afresh at
 * every dispatch. The run's region is copied out of the surface once, each
 * dab is a dispatch that reads the region as the dab before left it and
 * writes the whole of it on, dragged where the dab lies, and the last is
 * copied back. The drag is `fragmentMain`'s in `smudge.ts`, with one
 * difference: where a pixel lies in the dab is worked out from the pixel and
 * not interpolated across a quad, so the two agree to the rasteriser's
 * rounding and no closer.
 */
export const smudgeRunShader = preprocess(template, {
  pigment: pigmentShader,
  "run-workgroup": `#define RUN_WORKGROUP ${RUN_WORKGROUP}`,
})
