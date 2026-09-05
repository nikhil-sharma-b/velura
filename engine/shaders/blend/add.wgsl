fn blendChannel(b: f32, s: f32) -> f32 {
  return min(1.0, b + s);
}
