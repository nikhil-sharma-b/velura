#include "space"
@group(0) @binding(0) var<uniform> composite: Composite;
@group(0) @binding(1) var source: texture_2d<f32>;
@group(0) @binding(2) var docSampler: sampler;

@vertex
fn vertexMain(@builtin(vertex_index) index: u32) -> @builtin(position) vec4<f32> {
  let x = f32(i32(index) / 2) * 4.0 - 1.0;
  let y = f32(i32(index) & 1) * 4.0 - 1.0;
  return vec4<f32>(x, y, 0.0, 1.0);
}

@fragment
fn fragmentMain(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
  // Premultiplied, so scaling all four channels is the whole of "fade it".
  return readSurface(source, position.xy, composite.sourceInDoc) * composite.opacity;
}
