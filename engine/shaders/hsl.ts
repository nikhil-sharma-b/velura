/* Shared by colour filters and per-dab dynamics, in linear working light. */
export const hslShader = /* wgsl */ `
fn hueToRgb(p: f32, q: f32, t0: f32) -> f32 {
  let t = fract(t0);
  if (t < 1.0 / 6.0) { return p + (q - p) * 6.0 * t; }
  if (t < 0.5) { return q; }
  if (t < 2.0 / 3.0) { return p + (q - p) * (2.0 / 3.0 - t) * 6.0; }
  return p;
}

fn adjustHsl(rgb: vec3<f32>, adjustments: vec3<f32>) -> vec3<f32> {
  let high = max(rgb.r, max(rgb.g, rgb.b));
  let low = min(rgb.r, min(rgb.g, rgb.b));
  var l = (high + low) * 0.5;
  var h = 0.0;
  var s = 0.0;
  let d = high - low;
  if (d > 1e-6) {
    s = select(d / (2.0 - high - low), d / (high + low), l <= 0.5);
    if (high == rgb.r) {
      h = (rgb.g - rgb.b) / d + select(0.0, 6.0, rgb.g < rgb.b);
    } else if (high == rgb.g) {
      h = (rgb.b - rgb.r) / d + 2.0;
    } else {
      h = (rgb.r - rgb.g) / d + 4.0;
    }
    h = h / 6.0;
  }
  h = h + adjustments.x;
  s = clamp(s * (1.0 + adjustments.y), 0.0, 1.0);
  var out = vec3<f32>(l);
  if (s > 0.0) {
    let q = select(l + s - l * s, l * (1.0 + s), l < 0.5);
    let p = 2.0 * l - q;
    out = vec3<f32>(
      hueToRgb(p, q, h + 1.0 / 3.0),
      hueToRgb(p, q, h),
      hueToRgb(p, q, h - 1.0 / 3.0)
    );
  }
  // Lightness leans the result toward white or black, as far as it is set.
  let lightness = adjustments.z;
  if (lightness > 0.0) { out = mix(out, vec3<f32>(1.0), lightness); }
  if (lightness < 0.0) { out = out * (1.0 + lightness); }
  return out;
}

`
