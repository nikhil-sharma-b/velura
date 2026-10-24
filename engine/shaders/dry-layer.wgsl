// A layer with nothing wet on it: its pixel is its pixel. See `wet-layer`.
fn withWet(under: vec4<f32>, point: vec2<f32>) -> vec4<f32> {
  return under;
}
