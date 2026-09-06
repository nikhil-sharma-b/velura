// W3C Compositing and Blending Level 1, §10.2.
fn luminosity(c: vec3<f32>) -> f32 {
  return 0.3 * c.r + 0.59 * c.g + 0.11 * c.b;
}

fn saturation(c: vec3<f32>) -> f32 {
  return max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
}

fn clipColour(c: vec3<f32>) -> vec3<f32> {
  let l = luminosity(c);
  let low = min(c.r, min(c.g, c.b));
  let high = max(c.r, max(c.g, c.b));
  var result = c;
  if (low < 0.0) {
    result = vec3<f32>(l) + (result - vec3<f32>(l)) * l / (l - low);
  }
  if (high > 1.0) {
    result = vec3<f32>(l) + (result - vec3<f32>(l)) * (1.0 - l) / (high - l);
  }
  return result;
}

fn setLuminosity(c: vec3<f32>, l: f32) -> vec3<f32> {
  return clipColour(c + vec3<f32>(l - luminosity(c)));
}

fn setSaturation(c: vec3<f32>, s: f32) -> vec3<f32> {
  var result = vec3<f32>(0.0);
  let low = min(c.r, min(c.g, c.b));
  let high = max(c.r, max(c.g, c.b));
  if (high <= low) { return result; }
  let scale = s / (high - low);
  result = (c - vec3<f32>(low)) * scale;
  return result;
}
