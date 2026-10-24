// The present pass's uniform, read here only for the view: the ants are drawn
// through the same screen-to-document mapping the picture was, so they sit on
// the selection's edge at any zoom, rotation or flip.
struct Present {
  toOutput: mat3x3<f32>,
  background: vec4<f32>,
  strokeOpacity: f32,
  activeOpacity: f32,
  hasBelow: f32,
  hasAbove: f32,
  toDoc: mat3x3<f32>,
  docSize: vec2<f32>,
  strokeMode: f32,
  workspaceBackground: vec4<f32>,
}

@group(0) @binding(0) var<uniform> present: Present;
// One byte of coverage per document pixel (07).
@group(0) @binding(1) var selection: texture_2d<f32>;
// x: how far the dashes have marched, in screen pixels.
@group(0) @binding(2) var<uniform> ants: vec4<f32>;

@vertex
fn vertexMain(@builtin(vertex_index) index: u32) -> @builtin(position) vec4<f32> {
  let x = f32(i32(index) / 2) * 4.0 - 1.0;
  let y = f32(i32(index) & 1) * 4.0 - 1.0;
  return vec4<f32>(x, y, 0.0, 1.0);
}

/** Whether the document pixel under a screen point is at least half selected. */
fn selected(screen: vec2<f32>) -> bool {
  let point = (present.toDoc * vec3<f32>(screen, 1.0)).xy;
  if (any(point < vec2<f32>(0.0)) || any(point >= present.docSize)) {
    return false;
  }
  return textureLoad(selection, vec2<i32>(floor(point)), 0).r >= 0.5;
}

@fragment
fn fragmentMain(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
  let screen = position.xy;
  // Edge detection in screen space: a selected pixel with an unselected
  // neighbour one screen pixel away is on the outline, so the line stays one
  // pixel wide however far the canvas is zoomed.
  if (!selected(screen)) {
    discard;
  }
  let enclosed =
    selected(screen + vec2<f32>(1.0, 0.0)) &&
    selected(screen - vec2<f32>(1.0, 0.0)) &&
    selected(screen + vec2<f32>(0.0, 1.0)) &&
    selected(screen - vec2<f32>(0.0, 1.0));
  if (enclosed) {
    discard;
  }
  // Diagonal dashes, four pixels black and four white, shifted each tick.
  let dash = floor((screen.x + screen.y + ants.x) / 4.0) % 2.0;
  return vec4<f32>(vec3<f32>(dash), 1.0);
}
