#include "composite"
#include "stroke"
struct Composite {
  opacity: f32,
  strokeOpacity: f32,
  useMask: f32,
  useClip: f32,
  strokeMode: f32,
}
@group(0) @binding(0) var<uniform> composite: Composite;
@group(0) @binding(1) var source: texture_2d<f32>;
@group(0) @binding(2) var backdrop: texture_2d<f32>;
@group(0) @binding(3) var stroke: texture_2d<f32>;
@group(0) @binding(4) var mask: texture_2d<f32>;
@group(0) @binding(5) var clipBase: texture_2d<f32>;

@vertex
fn vertexMain(@builtin(vertex_index) index: u32) -> @builtin(position) vec4<f32> {
  return vec4<f32>(f32(i32(index) / 2) * 4.0 - 1.0, f32(i32(index) & 1) * 4.0 - 1.0, 0.0, 1.0);
}
@fragment
fn fragmentMain(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
  let texel = vec2<i32>(position.xy);
  let painted = textureLoad(source, texel, 0);
  var layer = painted;
  if (composite.strokeOpacity > 0.0) {
    layer = applyStroke(
      painted,
      textureLoad(stroke, texel, 0),
      composite.strokeOpacity,
      composite.strokeMode
    );
  }
  var reveal = 1.0;
  if (composite.useMask > 0.0) {
    var hidden = textureLoad(mask, texel, 0).a;
    if (composite.strokeOpacity < 0.0) {
      let strokeMask = textureLoad(stroke, texel, 0).a * -composite.strokeOpacity;
      let paintedMask = strokeMask + hidden * (1.0 - strokeMask);
      let erasedMask = hidden * (1.0 - strokeMask);
      hidden = mix(paintedMask, erasedMask, composite.strokeMode);
    }
    reveal *= 1.0 - hidden;
  }
  if (composite.useClip > 0.0) {
    reveal *= textureLoad(clipBase, texel, 0).a;
  }
  return blendOver(layer * composite.opacity * reveal, textureLoad(backdrop, texel, 0));
}
