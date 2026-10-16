// A layer with wet paint on it (D42): its pipelines read the wet fields and
// glaze them onto the layer's pixels. A layer with none is drawn by the
// pipelines made with `dry-layer` in this one's place, which read nothing.
// Needs the pigment mix included before it.

#include "wet"

@group(0) @binding(7) var wetSlots: texture_2d<u32>;
@group(0) @binding(8) var wetDeposited: texture_2d<f32>;
@group(0) @binding(9) var wetSuspended: texture_2d<f32>;
@group(0) @binding(10) var wetPaper: texture_2d<f32>;
@group(0) @binding(11) var wetSelection: texture_2d<f32>;
@group(0) @binding(12) var wetCoverage: texture_2d<f32>;

// A layer's pixel with whatever is wet over that document point glazed on.
fn withWet(under: vec4<f32>, point: vec2<f32>) -> vec4<f32> {
  return glazeWet(under, wetSlots, wetDeposited, wetSuspended, wetCoverage, wetPaper, wetSelection, point);
}
