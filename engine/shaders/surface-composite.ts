/**
 * Flattening one linear-light surface into another at an opacity, with a
 * full-screen triangle and premultiplied "over" in the pipeline's blend state.
 *
 * Two callers, one pass. The stroke buffer goes into its layer once, when the
 * pen lifts (D27) — which is why stroke opacity can be a whole-stroke
 * property: it is applied here, to the finished mark, rather than to each dab
 * as it lands. And each layer under or over the active one goes into its cache
 * at the layer's own opacity when the caches are rebuilt (D19).
 *
 * No colour encoding happens here: surfaces stay linear-light, and only the
 * present pass may encode (D10).
 */
export const surfaceCompositeShader = /* wgsl */ `
struct Composite {
  // Opacity of the whole surface, in [0, 1].
  opacity: f32,
}

@group(0) @binding(0) var<uniform> composite: Composite;
@group(0) @binding(1) var source: texture_2d<f32>;

@vertex
fn vertexMain(@builtin(vertex_index) index: u32) -> @builtin(position) vec4<f32> {
  let x = f32(i32(index) / 2) * 4.0 - 1.0;
  let y = f32(i32(index) & 1) * 4.0 - 1.0;
  return vec4<f32>(x, y, 0.0, 1.0);
}

@fragment
fn fragmentMain(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
  // Premultiplied, so scaling all four channels is the whole of "fade it".
  return textureLoad(source, vec2<i32>(position.xy), 0) * composite.opacity;
}
`
