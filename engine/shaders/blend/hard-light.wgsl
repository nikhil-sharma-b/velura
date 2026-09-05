fn blendChannel(b: f32, s: f32) -> f32 {
  if (s <= 0.5) { return 2.0 * b * s; }
  return 1.0 - 2.0 * (1.0 - b) * (1.0 - s);
}
