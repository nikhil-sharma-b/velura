#include "mode"

// W3C compositing-1 §10: straight colour only inside the blend function.
fn blendOver(source: vec4<f32>, backdrop: vec4<f32>) -> vec4<f32> {
  if (source.a <= 0.0) { return backdrop; }
  if (backdrop.a <= 0.0) { return source; }
  let mixed = blendColour(backdrop.rgb / backdrop.a, source.rgb / source.a);
  let rgb = source.rgb * (1.0 - backdrop.a) + backdrop.rgb * (1.0 - source.a)
    + source.a * backdrop.a * mixed;
  return vec4<f32>(rgb, source.a + backdrop.a * (1.0 - source.a));
}
