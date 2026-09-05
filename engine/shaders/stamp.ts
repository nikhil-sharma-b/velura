/**
 * The stamp pass. One instanced quad per dab, drawn into the linear-light
 * target with premultiplied `over` blending — no colour encoding happens here,
 * because only the present pass is allowed to encode (D10).
 *
 * The dab is procedural: a disc with a one-pixel feather at the rim. Tip
 * textures and canvas-space grain (D24) replace the falloff below without
 * changing this pass's shape.
 */
export const stampShader = /* wgsl */ `
struct Stamp {
  // Canvas size in pixels, for the pixel -> clip space mapping.
  viewport: vec2<f32>,
  // Falloff width at the rim, in pixels.
  feather: f32,
  padding: f32,
  // Premultiplied linear-light ink.
  color: vec4<f32>,
}

@group(0) @binding(0) var<uniform> stamp: Stamp;

struct Instance {
  // Dab centre in canvas pixels.
  @location(0) center: vec2<f32>,
  @location(1) radius: f32,
  @location(2) opacity: f32,
}

struct Varyings {
  @builtin(position) position: vec4<f32>,
  // Position within the dab, where the rim is at length 1.
  @location(0) local: vec2<f32>,
  @location(1) radius: f32,
  @location(2) opacity: f32,
}

@vertex
fn vertexMain(instance: Instance, @builtin(vertex_index) index: u32) -> Varyings {
  // Two triangles over the dab's bounding square.
  let corner = vec2<f32>(
    f32(index == 1u || index == 2u || index == 4u),
    f32(index == 2u || index == 4u || index == 5u)
  );
  let local = corner * 2.0 - 1.0;
  let pixel = instance.center + local * instance.radius;
  var out: Varyings;
  out.position = vec4<f32>(
    pixel.x / stamp.viewport.x * 2.0 - 1.0,
    1.0 - pixel.y / stamp.viewport.y * 2.0,
    0.0,
    1.0
  );
  out.local = local;
  out.radius = instance.radius;
  out.opacity = instance.opacity;
  return out;
}

@fragment
fn fragmentMain(varyings: Varyings) -> @location(0) vec4<f32> {
  let distance = length(varyings.local);
  // The feather is authored in pixels, so it stays one pixel wide whatever
  // the dab's size: small dabs would otherwise be all falloff and no core.
  let edge = max(0.0, 1.0 - stamp.feather / max(varyings.radius, 1.0));
  let coverage = 1.0 - smoothstep(edge, 1.0, distance);
  return stamp.color * (coverage * varyings.opacity);
}
`
