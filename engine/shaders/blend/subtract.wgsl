fn blendChannel(b: f32, s: f32) -> f32 {
  return max(0.0, b - s);
}
