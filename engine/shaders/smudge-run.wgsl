#include "run-workgroup"
#include "pigment"

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

@compute @workgroup_size(RUN_WORKGROUP, RUN_WORKGROUP)
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
