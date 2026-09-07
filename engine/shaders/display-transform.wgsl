#include "composite"
#include "stroke"

struct Present {
  // Working (linear Display P3) -> output primaries. Identity when the swap
  // chain is P3; a real conversion, which clips, when it is sRGB.
  toOutput: mat3x3<f32>,
  // Background in the working space, opaque.
  background: vec4<f32>,
  // Opacity of the stroke in flight, in [0, 1].
  strokeOpacity: f32,
  // The active layer's own opacity. Zero when it is hidden, which composites
  // to the same thing and saves the shader a second flag.
  activeOpacity: f32,
  // Whether each cache exists. A document with nothing under or over the
  // active layer allocates no cache for it, so the read has to be skipped.
  hasBelow: f32,
  hasAbove: f32,
  // Screen pixels -> document pixels: the view (D28) inverted. Identity when
  // the artist has not navigated, and when exporting, which is what keeps a
  // rotated or flipped view out of the file.
  toDoc: mat3x3<f32>,
  // The document's size in pixels, which every surface here is the size of.
  docSize: vec2<f32>,
  // One for destination-out erasing, zero for ordinary painting.
  strokeMode: f32,
  // Opaque workspace outside the document, making its edge visible.
  workspaceBackground: vec4<f32>,
}

@group(0) @binding(0) var<uniform> present: Present;
// Everything under the active layer, already flattened at each layer's opacity.
@group(0) @binding(1) var below: texture_2d<f32>;
// The layer being painted on. Named for what it is because "active" is a
// reserved word in WGSL.
@group(0) @binding(2) var activeLayer: texture_2d<f32>;
// The stroke in flight. Empty between strokes, so this pass is unconditional.
@group(0) @binding(3) var stroke: texture_2d<f32>;
// Everything over the active layer, flattened the same way.
@group(0) @binding(4) var above: texture_2d<f32>;
// Linear, so a magnified canvas is smooth rather than blocky. There are no
// mips: minification past a half is a preview of the whole piece, not a
// surface anyone judges an edge on.
@group(0) @binding(5) var viewSampler: sampler;

/** Premultiplied "over", in linear light. */
fn over(source: vec4<f32>, destination: vec3<f32>) -> vec3<f32> {
  return source.rgb + destination * (1.0 - source.a);
}

@vertex
fn vertexMain(@builtin(vertex_index) index: u32) -> @builtin(position) vec4<f32> {
  // A single oversized triangle covering the viewport.
  let x = f32(i32(index) / 2) * 4.0 - 1.0;
  let y = f32(i32(index) & 1) * 4.0 - 1.0;
  return vec4<f32>(x, y, 0.0, 1.0);
}

fn encodeTransfer(linear: vec3<f32>) -> vec3<f32> {
  let clipped = clamp(linear, vec3<f32>(0.0), vec3<f32>(1.0));
  let low = clipped * 12.92;
  let high = 1.055 * pow(clipped, vec3<f32>(1.0 / 2.4)) - 0.055;
  return select(high, low, clipped <= vec3<f32>(0.0031308));
}

/** The document point under this screen pixel, and whether it is on canvas. */
fn documentUv(position: vec2<f32>) -> vec3<f32> {
  let point = (present.toDoc * vec3<f32>(position, 1.0)).xy;
  let inside = all(point >= vec2<f32>(0.0)) && all(point < present.docSize);
  return vec3<f32>(point / present.docSize, select(0.0, 1.0, inside));
}

@fragment
fn fragmentMain(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
  let sampled = documentUv(position.xy);
  let uv = sampled.xy;
  // Off the canvas there is nothing to composite: the dark workspace shows
  // through, leaving the document's white backdrop visually distinct.
  if (sampled.z < 0.5) {
    return vec4<f32>(encodeTransfer(present.toOutput * present.workspaceBackground.rgb), 1.0);
  }
  var color = vec4<f32>(0.0);
  if (present.hasBelow > 0.5) {
    color = textureSampleLevel(below, viewSampler, uv, 0.0);
  }
  // The stroke buffer sits above the active layer's own pixels and is shown at
  // the stroke's opacity, so the mark on screen matches the one that will be
  // composited into the layer when the pen lifts.
  let painted = textureSampleLevel(activeLayer, viewSampler, uv, 0.0);
  // The layer's opacity applies to the mark in flight as well as to what is
  // already there: a stroke on a half-opaque layer is drawn on that layer.
  let composited = applyStroke(
    painted,
    textureSampleLevel(stroke, viewSampler, uv, 0.0),
    present.strokeOpacity,
    present.strokeMode
  ) * present.activeOpacity;
  color = blendOver(composited, color);
  if (present.hasAbove > 0.5) {
    let upper = textureSampleLevel(above, viewSampler, uv, 0.0);
    color = upper + color * (1.0 - upper.a);
  }
  return vec4<f32>(encodeTransfer(present.toOutput * over(color, present.background.rgb)), 1.0);
}
