/**
 * The stroke-composite pass. One full-screen triangle draws the stroke buffer
 * into the layer, once, when the pen lifts (D27) — which is why stroke opacity
 * can be a whole-stroke property: it is applied here, to the finished mark,
 * rather than to each dab as it lands.
 *
 * No colour encoding happens here: the layer stays linear-light, and only the
 * present pass may encode (D10).
 */
export const strokeCompositeShader = /* wgsl */ `
struct Composite {
  // Opacity of the stroke as a whole, in [0, 1].
  opacity: f32,
}

@group(0) @binding(0) var<uniform> composite: Composite;
@group(0) @binding(1) var stroke: texture_2d<f32>;

@vertex
fn vertexMain(@builtin(vertex_index) index: u32) -> @builtin(position) vec4<f32> {
  let x = f32(i32(index) / 2) * 4.0 - 1.0;
  let y = f32(i32(index) & 1) * 4.0 - 1.0;
  return vec4<f32>(x, y, 0.0, 1.0);
}

@fragment
fn fragmentMain(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
  // Premultiplied, so scaling all four channels is the whole of "fade it".
  return textureLoad(stroke, vec2<i32>(position.xy), 0) * composite.opacity;
}
`
