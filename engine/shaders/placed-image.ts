/**
 * Drawing a placed image into a layer at a placement (06).
 *
 * This is what makes moving a photograph interactive. The CPU route — decode,
 * resample into a canvas, read the pixels back, convert every one of them to
 * premultiplied linear P3 in JavaScript, upload the tiles — costs a quarter of
 * a second for a six-megapixel picture, which is three or four frames a second
 * while the artist drags. Here the original sits in a texture and the whole
 * adjustment is one textured quad: the sampler does the resampling, the sRGB
 * texture format does the transfer function, and the matrix below does the
 * gamut lift, all in the pass that draws it.
 *
 * The picture is still rendered from the original every time, so this is the
 * same "no accumulated softening" guarantee the CPU route gives (06); what
 * changes is only who does the arithmetic.
 *
 * The matrix mirrors `SRGB_TO_P3` in `engine/color/display-transform.ts`, and
 * is pinned to it the way the display transform's is: by a test that renders
 * through this shader and asserts against the CPU conversion.
 */
export const placedImageShader = /* wgsl */ `
struct Placement {
  // The quad's four corners in the layer's pixel space, clockwise from the
  // picture's own top left, each in the xy of its own slot. Corners rather
  // than a matrix: rotation, scale and mirroring are already one affine by
  // the time they reach here, and the vertex shader has nothing to do but
  // choose between them. Whole vec4 slots because an array in the uniform
  // address space is laid out on a 16-byte stride whatever it holds.
  corners: array<vec4<f32>, 4>,
  // The layer surface's size in pixels (xy), to put the corners into clip
  // space.
  surface: vec4<f32>,
}

@group(0) @binding(0) var<uniform> placement: Placement;
@group(0) @binding(1) var source: texture_2d<f32>;
@group(0) @binding(2) var sourceSampler: sampler;

struct Vertex {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

// Two triangles over the placement's own corners.
const CORNER_INDEX = array<u32, 6>(0u, 1u, 2u, 0u, 2u, 3u);
const CORNER_UV = array<vec2<f32>, 4>(
  vec2<f32>(0.0, 0.0),
  vec2<f32>(1.0, 0.0),
  vec2<f32>(1.0, 1.0),
  vec2<f32>(0.0, 1.0),
);

@vertex
fn vertexMain(@builtin(vertex_index) index: u32) -> Vertex {
  let corner = CORNER_INDEX[index];
  let pixel = placement.corners[corner].xy;
  // Pixel space to clip space: y is down on the surface and up in clip space.
  let clip = vec2<f32>(
    pixel.x / placement.surface.x * 2.0 - 1.0,
    1.0 - pixel.y / placement.surface.y * 2.0,
  );
  var out: Vertex;
  out.position = vec4<f32>(clip, 0.0, 1.0);
  out.uv = CORNER_UV[corner];
  return out;
}

// Linear sRGB primaries to the linear P3 working space (D10).
const SRGB_TO_P3 = mat3x3<f32>(
  0.8224621, 0.0331941, 0.0170827,
  0.1775380, 0.9668058, 0.0723974,
  0.0000000, 0.0000000, 0.9105199,
);

@fragment
fn fragmentMain(vertex: Vertex) -> @location(0) vec4<f32> {
  // The texture is sRGB-encoded, so this sample is already linear light; the
  // hardware did the transfer function the CPU route spends a pow on.
  let source_color = textureSample(source, sourceSampler, vertex.uv);
  let working = SRGB_TO_P3 * source_color.rgb;
  // Premultiplied, like every other surface in the document.
  return vec4<f32>(working * source_color.a, source_color.a);
}
`
