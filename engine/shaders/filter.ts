import { hslShader } from "./hsl"
/**
 * The filters (18), as full-screen passes over a layer's linear-light,
 * premultiplied pixels. Every pass reads the layer as it was before the filter
 * began (`original`), so a preview redrawn at new settings starts from the
 * same pixels rather than from the last preview. The pass that writes the
 * layer mixes the filtered pixel with the original by the selection's
 * coverage: all of it inside, a share on a feathered edge, none outside.
 *
 * Colour filters are one pass. The blur is two — across into `between`, then
 * down from it — sharing one side of a normalised Gaussian. It blurs the
 * premultiplied values, which is what keeps a transparent neighbour's colour
 * from bleeding into an opaque edge.
 */
export const filterShader = /* wgsl */ `
struct Params {
  // 0: hue/saturation/lightness, 1: brightness/contrast.
  kind: u32,
  hasSelection: u32,
  reach: i32,
  _pad: u32,
  // hue (turns), saturation, lightness / brightness, contrast.
  values: vec4<f32>,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var original: texture_2d<f32>;
@group(0) @binding(2) var between: texture_2d<f32>;
@group(0) @binding(3) var selection: texture_2d<f32>;
@group(0) @binding(4) var<storage, read> kernel: array<f32>;

@vertex
fn vertexMain(@builtin(vertex_index) index: u32) -> @builtin(position) vec4<f32> {
  let x = f32(i32(index) / 2) * 4.0 - 1.0;
  let y = f32(i32(index) & 1) * 4.0 - 1.0;
  return vec4<f32>(x, y, 0.0, 1.0);
}

fn coverage(texel: vec2<i32>) -> f32 {
  if (params.hasSelection == 0u) { return 1.0; }
  return textureLoad(selection, texel, 0).r;
}

${hslShader}

// Middle grey in linear light, which contrast spreads from.
const PIVOT = 0.18;

fn adjustBrightnessContrast(rgb: vec3<f32>) -> vec3<f32> {
  let bright = rgb + vec3<f32>(params.values.x);
  return (bright - vec3<f32>(PIVOT)) * params.values.y + vec3<f32>(PIVOT);
}

@fragment
fn colourMain(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
  let texel = vec2<i32>(position.xy);
  let before = textureLoad(original, texel, 0);
  if (before.a <= 0.0) { return before; }
  let straight = before.rgb / before.a;
  var rgb: vec3<f32>;
  if (params.kind == 0u) {
    rgb = adjustHsl(clamp(straight, vec3<f32>(0.0), vec3<f32>(1.0)), params.values.xyz);
  } else {
    rgb = adjustBrightnessContrast(straight);
  }
  let after = vec4<f32>(clamp(rgb, vec3<f32>(0.0), vec3<f32>(1.0)) * before.a, before.a);
  return mix(before, after, coverage(texel));
}

fn blurAlong(source: texture_2d<f32>, texel: vec2<i32>, step: vec2<i32>) -> vec4<f32> {
  let size = vec2<i32>(textureDimensions(source));
  var sum = textureLoad(source, texel, 0) * kernel[0];
  for (var i = 1; i <= params.reach; i++) {
    // The edge texel stands in for what is past it, so an opaque layer's
    // border does not fade toward transparency.
    let ahead = clamp(texel + step * i, vec2<i32>(0), size - 1);
    let behind = clamp(texel - step * i, vec2<i32>(0), size - 1);
    sum += (textureLoad(source, ahead, 0) + textureLoad(source, behind, 0)) * kernel[i];
  }
  return sum;
}

@fragment
fn blurAcrossMain(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
  return blurAlong(original, vec2<i32>(position.xy), vec2<i32>(1, 0));
}

@fragment
fn blurDownMain(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
  let texel = vec2<i32>(position.xy);
  let blurred = blurAlong(between, texel, vec2<i32>(0, 1));
  return mix(textureLoad(original, texel, 0), blurred, coverage(texel));
}
`
