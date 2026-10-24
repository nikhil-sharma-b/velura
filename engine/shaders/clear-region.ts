/**
 * Clears a region of the stroke buffer and its coverage depth (D30): a
 * full-screen triangle at the far plane writing transparent ink, drawn under
 * a scissor rectangle. A load-op clear cannot be scissored, and at 8192² it
 * writes the whole buffer when a stroke touched a few thousand pixels of it.
 */
export const clearRegionShader = /* wgsl */ `
@vertex
fn vertexMain(@builtin(vertex_index) index: u32) -> @builtin(position) vec4<f32> {
  let x = f32(i32(index) / 2) * 4.0 - 1.0;
  let y = f32(i32(index) & 1) * 4.0 - 1.0;
  return vec4<f32>(x, y, 1.0, 1.0);
}

@fragment
fn fragmentMain() -> @location(0) vec4<f32> {
  return vec4<f32>(0.0);
}
`
