import { pigmentShader } from "./pigment"

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
export const smudgeRunShader = /* wgsl */ `
${pigmentShader}

const TAU = 6.283185307179586;

struct RunDab {
  // Canvas size in pixels.
  viewport: vec2<f32>,
  // Falloff width at the rim, in pixels.
  feather: f32,
  // One when the tip texture is the dab's shape, zero for the procedural disc.
  useTip: f32,
  // Dab centre in canvas pixels.
  center: vec2<f32>,
  // How far the tip has come since the dab before, in canvas pixels.
  travel: vec2<f32>,
  radius: f32,
  strength: f32,
  // Rotation of the tip, as a turn clockwise.
  angle: f32,
  // Width of the tip against its length, in (0, 1].
  roundness: f32,
  tipFrame: f32,
  // One when a selection clips the smear, zero when nothing is selected.
  useSelection: f32,
  // The canvas pixel the region's first texel was copied from, and its size.
  region: vec2<f32>,
  regionSize: vec2<f32>,
  // The canvas pixels the dab may write: left, top, right, bottom.
  clip: vec4<f32>,
}

@group(0) @binding(0) var<uniform> dab: RunDab;
@group(0) @binding(1) var tipSampler: sampler;
@group(0) @binding(2) var tipTexture: texture_2d_array<f32>;
@group(0) @binding(3) var carrySampler: sampler;
// The region as the dab before left it.
@group(0) @binding(4) var state: texture_2d<f32>;
// What is dragged from: the same, or the frozen artwork when that is sampled.
@group(0) @binding(5) var behindTexture: texture_2d<f32>;
@group(0) @binding(6) var selectionTexture: texture_2d<f32>;
@group(0) @binding(7) var next: texture_storage_2d<rgba16float, write>;

fn dragged(here: vec4<f32>, position: vec2<f32>, local: vec2<f32>) -> vec4<f32> {
  let distance = length(local);
  let edge = max(0.0, 1.0 - dab.feather / max(dab.radius, 1.0));
  // A hard tip must not call smoothstep with identical endpoints.
  var disc = 1.0 - step(1.0, distance);
  if (dab.feather > 0.0) {
    disc = 1.0 - smoothstep(edge, 1.0, distance);
  }
  let tip = textureSampleLevel(tipTexture, tipSampler, local * 0.5 + 0.5, i32(dab.tipFrame), 0.0).r;
  let shape = mix(disc, tip, dab.useTip);

  let source = position - dab.travel;
  let size = vec2<f32>(textureDimensions(behindTexture));
  // Held to the canvas's own texel centres, as the copy stops at the canvas.
  let within = clamp(source, vec2<f32>(0.5), dab.viewport - vec2<f32>(0.5));
  var behind = textureSampleLevel(behindTexture, carrySampler, (within - dab.region) / size, 0.0);
  // Past the canvas there is nothing, and nothing is what is dragged in.
  if (source.x < 0.0 || source.y < 0.0 || source.x > dab.viewport.x || source.y > dab.viewport.y) {
    behind = vec4<f32>(0.0);
  }
  var selected = 1.0;
  if (dab.useSelection > 0.0) {
    selected = textureLoad(selectionTexture, vec2<i32>(position), 0).r;
  }
  return mixPaint(here, behind, clamp(dab.strength * shape * selected, 0.0, 1.0));
}

@compute @workgroup_size(${RUN_WORKGROUP}, ${RUN_WORKGROUP})
fn runMain(@builtin(global_invocation_id) id: vec3<u32>) {
  let texel = vec2<f32>(id.xy);
  if (texel.x >= dab.regionSize.x || texel.y >= dab.regionSize.y) { return; }
  let here = textureLoad(state, vec2<i32>(id.xy), 0);
  // The pixel's centre on the canvas, as a fragment's position is.
  let position = dab.region + texel + vec2<f32>(0.5);
  // The dab's quad, turned back: the rim is at length 1.
  let offset = position - dab.center;
  let turn = dab.angle * TAU;
  let cosine = cos(turn);
  let sine = sin(turn);
  let local = vec2<f32>(
    offset.x * cosine + offset.y * sine,
    offset.y * cosine - offset.x * sine
  ) / (dab.radius * vec2<f32>(1.0, dab.roundness));
  var result = here;
  if (all(position > dab.clip.xy) && all(position < dab.clip.zw)
      && all(local >= vec2<f32>(-1.0)) && all(local < vec2<f32>(1.0))) {
    result = dragged(here, position, local);
  }
  // Every texel is written on, dragged or not: the next dab reads this one.
  textureStore(next, vec2<i32>(id.xy), result);
}
`
