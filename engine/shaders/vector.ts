import { grainCarveShader } from "./grain"

/**
 * The paper a vector stroke's grain bites, as a multiple of the paper
 * texture's own pixels: the pixel Pencil's, so the two read as one pencil.
 */
export const VECTOR_PAPER_SCALE = 0.45

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
 * Geometry is in document pixels; `chunk` says where it lands in the target
 * and which piece of the target this pass covers, so a large redraw is done
 * a piece at a time into one fixed-size multisampled target. The target is
 * the layer's own pixels, or the screen through the view (sharp-zoom 02),
 * where the shapes are drawn from their geometry at whatever magnification
 * rather than sampled from those pixels. Nothing lands off the document.
 */
export const vectorShader = /* wgsl */ `
struct Chunk {
  // Document pixels -> pixels of the piece drawn.
  toPiece: mat3x3<f32>,
  // The multisampled target's size, and the document's.
  size: vec2<f32>,
  docSize: vec2<f32>,
}

@group(0) @binding(0) var<uniform> chunk: Chunk;

fn toClip(position: vec2<f32>) -> vec4<f32> {
  let local = (chunk.toPiece * vec3<f32>(position, 1.0)).xy / chunk.size;
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

@group(0) @binding(1) var paperSampler: sampler;
@group(0) @binding(2) var paper: texture_2d<f32>;

${grainCarveShader}

const PAPER_SCALE = ${VECTOR_PAPER_SCALE};

struct Covered {
  @builtin(position) position: vec4<f32>,
  // Premultiplied linear light, as every layer holds it.
  @location(0) color: vec4<f32>,
  // Where this is in the document: the map is affine, so interpolating the
  // corners' is exact.
  @location(1) document: vec2<f32>,
  // How deep the paper's grain bites, and how much graphite is laid: both
  // vary along a stroke whose pressure varies them.
  @location(2) depth: f32,
  @location(3) tone: f32,
}

@vertex
fn coverVertex(
  @location(0) position: vec2<f32>,
  @location(1) color: vec4<f32>,
  @location(2) depth: f32,
  @location(3) tone: f32,
) -> Covered {
  return Covered(toClip(position), color, position, depth, tone);
}

@fragment
fn coverFragment(input: Covered) -> @location(0) vec4<f32> {
  if (any(input.document < vec2<f32>(0.0)) || any(input.document >= chunk.docSize)) {
    discard;
  }
  // The paper lies still under the document, as it does under a dab. Read
  // at level 0: the texture has no mips, and this flow is not uniform.
  let size = vec2<f32>(textureDimensions(paper)) * PAPER_SCALE;
  let grain = textureSampleLevel(paper, paperSampler, input.document / size, 0.0).r;
  return input.color * input.tone * grainCarve(grain, input.depth);
}
`
