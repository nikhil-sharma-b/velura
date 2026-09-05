/**
 * The present pass. One full-screen triangle composites the flattened cache
 * below the active layer, the active layer with the stroke in flight, and the
 * flattened cache above it over the background, converts working-space
 * primaries to the output colour space and applies the transfer function.
 *
 * At most four texture reads, whatever the stack is: fifty layers cost what
 * two do, because everything but the active layer was flattened when the
 * structure last changed and not since (D19).
 * Export and preview render through this same shader (D10); nothing else may
 * encode colour.
 *
 * `encodeTransfer` below mirrors the CPU reference in
 * `engine/color/display-transform.ts`; the golden-image test pins them together.
 *
 * D34 puts WGSL in `.wgsl` files behind an `#include`/`#define` preprocessor.
 * That preprocessor arrives with the generated blend-mode pipelines (D20) that
 * need snippet composition; this single self-contained pass does not yet.
 */
export const displayTransformShader = /* wgsl */ `
struct Present {
  // Working (linear Display P3) -> output primaries. Identity when the swap
  // chain is P3; a real conversion, which clips, when it is sRGB.
  toOutput: mat3x3<f32>,
  // Background in the working space, opaque.
  background: vec4<f32>,
  // Opacity of the stroke in flight, in [0, 1].
  strokeOpacity: f32,
  // The active layer's own opacity. Zero when it is hidden, which composites
  // to the same thing and saves the shader a second flag.
  activeOpacity: f32,
  // Whether each cache exists. A document with nothing under or over the
  // active layer allocates no cache for it, so the read has to be skipped.
  hasBelow: f32,
  hasAbove: f32,
}

@group(0) @binding(0) var<uniform> present: Present;
// Everything under the active layer, already flattened at each layer's opacity.
@group(0) @binding(1) var below: texture_2d<f32>;
// The layer being painted on. Named for what it is because "active" is a
// reserved word in WGSL.
@group(0) @binding(2) var activeLayer: texture_2d<f32>;
// The stroke in flight. Empty between strokes, so this pass is unconditional.
@group(0) @binding(3) var stroke: texture_2d<f32>;
// Everything over the active layer, flattened the same way.
@group(0) @binding(4) var above: texture_2d<f32>;

/** Premultiplied "over", in linear light. */
fn over(source: vec4<f32>, destination: vec3<f32>) -> vec3<f32> {
  return source.rgb + destination * (1.0 - source.a);
}

@vertex
fn vertexMain(@builtin(vertex_index) index: u32) -> @builtin(position) vec4<f32> {
  // A single oversized triangle covering the viewport.
  let x = f32(i32(index) / 2) * 4.0 - 1.0;
  let y = f32(i32(index) & 1) * 4.0 - 1.0;
  return vec4<f32>(x, y, 0.0, 1.0);
}

fn encodeTransfer(linear: vec3<f32>) -> vec3<f32> {
  let clipped = clamp(linear, vec3<f32>(0.0), vec3<f32>(1.0));
  let low = clipped * 12.92;
  let high = 1.055 * pow(clipped, vec3<f32>(1.0 / 2.4)) - 0.055;
  return select(high, low, clipped <= vec3<f32>(0.0031308));
}

@fragment
fn fragmentMain(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
  // Texel-for-texel: every surface here is the size of the swap chain.
  let texel = vec2<i32>(position.xy);
  var color = present.background.rgb;
  if (present.hasBelow > 0.5) {
    color = over(textureLoad(below, texel, 0), color);
  }
  // The stroke buffer sits above the active layer's own pixels and is shown at
  // the stroke's opacity, so the mark on screen matches the one that will be
  // composited into the layer when the pen lifts.
  let inFlight = textureLoad(stroke, texel, 0) * present.strokeOpacity;
  let painted = textureLoad(activeLayer, texel, 0);
  // The layer's opacity applies to the mark in flight as well as to what is
  // already there: a stroke on a half-opaque layer is drawn on that layer.
  let composited = (inFlight + painted * (1.0 - inFlight.a)) * present.activeOpacity;
  color = over(composited, color);
  if (present.hasAbove > 0.5) {
    color = over(textureLoad(above, texel, 0), color);
  }
  return vec4<f32>(encodeTransfer(present.toOutput * color), 1.0);
}
`
