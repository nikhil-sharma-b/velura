/**
 * The present pass. One full-screen triangle composites the linear-light layer
 * over the background, converts working-space primaries to the output colour
 * space and applies the transfer function. Export and preview render through
 * this same shader (D10); nothing else may encode colour.
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
}

@group(0) @binding(0) var<uniform> present: Present;
@group(0) @binding(1) var layer: texture_2d<f32>;

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
  // Texel-for-texel: the layer target is the size of the swap chain.
  let painted = textureLoad(layer, vec2<i32>(position.xy), 0);
  // Premultiplied "over" in linear light, before any encoding.
  let composited = painted.rgb + present.background.rgb * (1.0 - painted.a);
  return vec4<f32>(encodeTransfer(present.toOutput * composited), 1.0);
}
`
