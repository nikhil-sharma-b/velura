#include "composite"
struct Composite { opacity: f32, strokeOpacity: f32, }
@group(0) @binding(0) var<uniform> composite: Composite;
@group(0) @binding(1) var source: texture_2d<f32>;
@group(0) @binding(2) var backdrop: texture_2d<f32>;
@group(0) @binding(3) var stroke: texture_2d<f32>;

@vertex
fn vertexMain(@builtin(vertex_index) index: u32) -> @builtin(position) vec4<f32> {
  return vec4<f32>(f32(i32(index) / 2) * 4.0 - 1.0, f32(i32(index) & 1) * 4.0 - 1.0, 0.0, 1.0);
}
@fragment
fn fragmentMain(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
  let texel = vec2<i32>(position.xy);
  let painted = textureLoad(source, texel, 0);
  var inFlight = vec4<f32>(0.0);
  if (composite.strokeOpacity > 0.0) {
    inFlight = textureLoad(stroke, texel, 0) * composite.strokeOpacity;
  }
  let layer = (inFlight + painted * (1.0 - inFlight.a)) * composite.opacity;
  return blendOver(layer, textureLoad(backdrop, texel, 0));
}
