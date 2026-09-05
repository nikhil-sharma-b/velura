fn blendChannel(b: f32, s: f32) -> f32 {
  return b + s - 2.0 * b * s;
}
