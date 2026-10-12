// Where a canvas pixel lies in a direct dab, worked out from the pixel: the
// dab's quad turned back and scaled so the rim is at length 1. The render
// pass and the run's compute pass both ask this and neither interpolates it
// across the quad, which is what makes the two one smear (live brushes 27):
// a rasteriser snaps a quad's corners to its own grid, and at a rim a pixel
// wide a hundredth of a pixel is levels of coverage.

const TAU = 6.283185307179586;

fn dabLocal(position: vec2<f32>, center: vec2<f32>, angle: f32, radius: f32, roundness: f32) -> vec2<f32> {
  let offset = position - center;
  let turn = angle * TAU;
  let cosine = cos(turn);
  let sine = sin(turn);
  return vec2<f32>(
    offset.x * cosine + offset.y * sine,
    offset.y * cosine - offset.x * sine
  ) / (radius * vec2<f32>(1.0, roundness));
}

// Whether that position is in the dab: its quad, the far edges left out.
fn inDab(local: vec2<f32>) -> bool {
  return all(local >= vec2<f32>(-1.0)) && all(local < vec2<f32>(1.0));
}
