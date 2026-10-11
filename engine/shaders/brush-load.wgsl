#include "hsl"
struct Load {
  color: vec4<f32>,
  offsets: vec4<f32>,
}
@group(0) @binding(0) var<uniform> load: Load;

@vertex
fn vertexMain(@builtin(vertex_index) index: u32) -> @builtin(position) vec4<f32> {
  let x = f32(index == 1u) * 4.0 - 1.0;
  let y = f32(index == 2u) * 4.0 - 1.0;
  return vec4<f32>(x, y, 0.0, 1.0);
}

@fragment
fn fragmentMain() -> @location(0) vec4<f32> {
  if (load.color.a <= 0.0) { return load.color; }
  return vec4<f32>(adjustHsl(load.color.rgb / load.color.a, load.offsets.xyz)
    * load.color.a, load.color.a);
}
