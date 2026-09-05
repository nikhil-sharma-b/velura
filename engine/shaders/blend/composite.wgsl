#include "mode"

// W3C compositing-1 §10: straight colour only inside the blend function.
// Transparent pixels never divide by zero; all surfaces remain premultiplied.
fn blendOver(source: vec4<f32>, backdrop: vec4<f32>) -> vec4<f32> {
  if (source.a <= 0.0) { return backdrop; }
  if (backdrop.a <= 0.0) { return source; }
  let s = source.rgb / source.a;
  let b = backdrop.rgb / backdrop.a;
  let mixed = vec3<f32>(blendChannel(b.r, s.r), blendChannel(b.g, s.g), blendChannel(b.b, s.b));
  let rgb = source.rgb * (1.0 - backdrop.a) + backdrop.rgb * (1.0 - source.a)
    + source.a * backdrop.a * mixed;
  return vec4<f32>(rgb, source.a + backdrop.a * (1.0 - source.a));
}
