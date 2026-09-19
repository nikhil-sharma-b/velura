/**
 * One layer's pixels, shrunk to a layer-list thumbnail.
 *
 * The document is fitted into the thumbnail whole, letterboxed with
 * transparency, so its shape reads the same in every row. Shrinking a
 * document forty-fold with one bilinear tap would drop a thin line entirely,
 * so each thumbnail pixel averages a grid of taps across its footprint — what
 * a mip chain would give, without keeping one for every layer.
 *
 * Colour is laid over a checkerboard, so transparent and white stay
 * different things. A mask is shown as what it lets through: white reveals,
 * black hides. Both encode for display here, as the present pass does (D10).
 */
export const thumbnailShader = /* wgsl */ `
struct Thumbnail {
  // Working (linear Display P3) -> output primaries.
  toOutput: mat3x3<f32>,
  docSize: vec2<f32>,
  targetSize: vec2<f32>,
  // Zero for a layer's colour, one for a mask's coverage.
  mode: f32,
}

@group(0) @binding(0) var<uniform> thumbnail: Thumbnail;
@group(0) @binding(1) var source: texture_2d<f32>;
@group(0) @binding(2) var sourceSampler: sampler;

@vertex
fn vertexMain(@builtin(vertex_index) index: u32) -> @builtin(position) vec4<f32> {
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

@fragment
fn fragmentMain(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
  let scale = min(
    thumbnail.targetSize.x / thumbnail.docSize.x,
    thumbnail.targetSize.y / thumbnail.docSize.y
  );
  let offset = (thumbnail.targetSize - thumbnail.docSize * scale) * 0.5;
  let origin = (position.xy - vec2<f32>(0.5) - offset) / scale;
  let footprint = 1.0 / scale;
  if (any(origin + footprint * 0.5 < vec2<f32>(0.0)) ||
      any(origin + footprint * 0.5 > thumbnail.docSize)) {
    return vec4<f32>(0.0);
  }
  // Each bilinear tap already averages two texels a side, so a footprint of
  // n texels needs n / 2 taps a side. Capped: past that, a shrunk document is
  // a picture of its composition rather than of its strokes.
  let taps = clamp(u32(ceil(footprint * 0.5)), 1u, 8u);
  var sum = vec4<f32>(0.0);
  for (var row = 0u; row < taps; row++) {
    for (var column = 0u; column < taps; column++) {
      let point = origin + (vec2<f32>(f32(column), f32(row)) + 0.5) * footprint / f32(taps);
      sum += textureSampleLevel(source, sourceSampler, point / thumbnail.docSize, 0.0);
    }
  }
  let texel = sum / f32(taps * taps);
  if (thumbnail.mode > 0.5) {
    // A mask holds how much it hides, in alpha.
    let reveal = vec3<f32>(1.0 - texel.a);
    return vec4<f32>(encodeTransfer(reveal), 1.0);
  }
  // A four-pixel checker, in linear light, behind premultiplied colour.
  let cell = vec2<u32>(position.xy / 4.0);
  let light = select(0.62, 0.86, (cell.x + cell.y) % 2u == 0u);
  let color = texel.rgb + vec3<f32>(light) * (1.0 - texel.a);
  return vec4<f32>(encodeTransfer(thumbnail.toOutput * color), 1.0);
}
`
