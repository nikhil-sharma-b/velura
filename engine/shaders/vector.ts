/**
 * Drawing a vector layer's objects into its pixels (19), by stencil and cover.
 *
 * Each object's fill arrives as a fan of triangles whose signed overlaps add
 * up to the outline's winding number (`engine/geom/tessellate.ts`). The
 * stencil pass counts them into a multisampled stencil buffer, writing no
 * colour; the cover pass then draws one quad over the object's bounds in its
 * colour, kept only where the count passes the fill rule, and zeroes the
 * stencil under the whole quad on the way so the next object starts clean.
 * Antialiasing is the multisampling: each sample is counted on its own.
 *
 * Everything is in document pixels; `chunk` says which part of the document
 * this pass covers, so a large redraw is done a piece at a time into one
 * fixed-size multisampled target.
 */
export const vectorShader = /* wgsl */ `
struct Chunk {
  // Top-left of the region drawn, in document pixels, and the target's size.
  origin: vec2<f32>,
  size: vec2<f32>,
}

@group(0) @binding(0) var<uniform> chunk: Chunk;

fn toClip(position: vec2<f32>) -> vec4<f32> {
  let local = (position - chunk.origin) / chunk.size;
  // y is down in the document and up in clip space.
  return vec4<f32>(local.x * 2.0 - 1.0, 1.0 - local.y * 2.0, 0.0, 1.0);
}

@vertex
fn stencilVertex(@location(0) position: vec2<f32>) -> @builtin(position) vec4<f32> {
  return toClip(position);
}

// The pass has a colour target, so the stencil pipelines declare one too;
// their write mask is empty, and this value goes nowhere.
@fragment
fn stencilFragment() -> @location(0) vec4<f32> {
  return vec4<f32>(0.0);
}

struct Covered {
  @builtin(position) position: vec4<f32>,
  // Premultiplied linear light, as every layer holds it.
  @location(0) color: vec4<f32>,
}

@vertex
fn coverVertex(
  @location(0) position: vec2<f32>,
  @location(1) color: vec4<f32>,
) -> Covered {
  return Covered(toClip(position), color);
}

@fragment
fn coverFragment(input: Covered) -> @location(0) vec4<f32> {
  return input.color;
}
`
