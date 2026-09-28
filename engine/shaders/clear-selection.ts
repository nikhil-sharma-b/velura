/**
 * Clear within the selection (08): a full-screen triangle whose alpha is the
 * mask's coverage, drawn with premultiplied destination-out, so a layer loses
 * exactly as much of each pixel as is selected — all of it inside, part of it
 * on a soft edge, none of it outside.
 */
export const clearSelectionShader = /* wgsl */ `
@group(0) @binding(0) var selection: texture_2d<f32>;

@vertex
fn vertexMain(@builtin(vertex_index) index: u32) -> @builtin(position) vec4<f32> {
  let x = f32(i32(index) / 2) * 4.0 - 1.0;
  let y = f32(i32(index) & 1) * 4.0 - 1.0;
  return vec4<f32>(x, y, 0.0, 1.0);
}

@fragment
fn fragmentMain(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
  return vec4<f32>(0.0, 0.0, 0.0, textureLoad(selection, vec2<i32>(position.xy), 0).r);
}
`
