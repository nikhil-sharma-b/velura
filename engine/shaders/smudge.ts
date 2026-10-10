/**
 * The smudge pass (smudge 01). One quad per dab, drawn straight into the
 * layer: each fragment is mixed towards the pixel one dab's travel behind it,
 * so what was under the tip a step ago is dragged to where the tip is now.
 * Nothing is laid down — the pass only moves what the layer holds, and it
 * moves all four premultiplied channels alike, so transparency is carried as
 * paint is.
 *
 * A pass cannot read the texture it writes, so the dab's neighbourhood is
 * copied into `carry` first and both pixels are read from there. `origin` is
 * where that copy was taken from, in document pixels.
 *
 * The dab's shape is the stamp pass's: the procedural disc with its feathered
 * rim, or the brush's tip texture, turned and squashed in the vertex stage.
 */
export const smudgeShader = /* wgsl */ `
const TAU = 6.283185307179586;

struct Smudge {
  // Canvas size in pixels, for the pixel -> clip space mapping.
  viewport: vec2<f32>,
  // Falloff width at the rim, in pixels.
  feather: f32,
  // One when the tip texture is the dab's shape, zero for the procedural disc.
  useTip: f32,
}

@group(0) @binding(0) var<uniform> smudge: Smudge;
@group(0) @binding(1) var tipSampler: sampler;
@group(0) @binding(2) var tipTexture: texture_2d_array<f32>;
@group(0) @binding(3) var carrySampler: sampler;
@group(0) @binding(4) var carry: texture_2d<f32>;

struct Instance {
  // Dab centre in canvas pixels.
  @location(0) center: vec2<f32>,
  @location(1) radius: f32,
  // How much of the pixel behind replaces the one here, in [0, 1].
  @location(2) strength: f32,
  // Rotation of the tip, as a turn clockwise.
  @location(3) angle: f32,
  // Width of the tip against its length, in (0, 1].
  @location(4) roundness: f32,
  @location(5) tipFrame: f32,
  // How far the tip has come since the dab before, in canvas pixels.
  @location(6) travel: vec2<f32>,
  // The canvas pixel the carry texture's first texel was copied from.
  @location(7) origin: vec2<f32>,
}

struct Varyings {
  @builtin(position) position: vec4<f32>,
  // Position within the dab, where the rim is at length 1.
  @location(0) local: vec2<f32>,
  @location(1) @interpolate(flat) radius: f32,
  @location(2) @interpolate(flat) strength: f32,
  @location(3) @interpolate(flat) tipFrame: i32,
  @location(4) @interpolate(flat) travel: vec2<f32>,
  @location(5) @interpolate(flat) origin: vec2<f32>,
}

@vertex
fn vertexMain(instance: Instance, @builtin(vertex_index) index: u32) -> Varyings {
  let corner = vec2<f32>(
    f32(index == 1u || index == 2u || index == 4u),
    f32(index == 2u || index == 4u || index == 5u)
  );
  let local = corner * 2.0 - 1.0;
  let shaped = local * instance.radius * vec2<f32>(1.0, instance.roundness);
  let turn = instance.angle * TAU;
  let cosine = cos(turn);
  let sine = sin(turn);
  let rotated = vec2<f32>(
    shaped.x * cosine - shaped.y * sine,
    shaped.x * sine + shaped.y * cosine
  );
  let pixel = instance.center + rotated;
  var out: Varyings;
  out.position = vec4<f32>(
    pixel.x / smudge.viewport.x * 2.0 - 1.0,
    1.0 - pixel.y / smudge.viewport.y * 2.0,
    0.0,
    1.0
  );
  out.local = local;
  out.radius = instance.radius;
  out.strength = instance.strength;
  out.tipFrame = i32(instance.tipFrame);
  out.travel = instance.travel;
  out.origin = instance.origin;
  return out;
}

@fragment
fn fragmentMain(varyings: Varyings) -> @location(0) vec4<f32> {
  let distance = length(varyings.local);
  let edge = max(0.0, 1.0 - smudge.feather / max(varyings.radius, 1.0));
  // A hard tip must not call smoothstep with identical endpoints.
  var disc = 1.0 - step(1.0, distance);
  if (smudge.feather > 0.0) {
    disc = 1.0 - smoothstep(edge, 1.0, distance);
  }
  let tip = textureSample(tipTexture, tipSampler, varyings.local * 0.5 + 0.5, varyings.tipFrame).r;
  let shape = mix(disc, tip, smudge.useTip);

  let here = textureLoad(carry, vec2<i32>(varyings.position.xy - varyings.origin), 0);
  // Between texels, since a dab's travel is rarely a whole pixel: without
  // the blend a slow drag would round to no travel and smear nothing.
  let source = varyings.position.xy - varyings.travel;
  let size = vec2<f32>(textureDimensions(carry));
  // Held to the canvas's own texel centres: the copy stops at the canvas, and
  // what the texture holds past it is some earlier dab's.
  let within = clamp(source, vec2<f32>(0.5), smudge.viewport - vec2<f32>(0.5));
  var behind = textureSampleLevel(carry, carrySampler, (within - varyings.origin) / size, 0.0);
  // Past the canvas there is nothing, and nothing is what is dragged in.
  if (source.x < 0.0 || source.y < 0.0 || source.x > smudge.viewport.x || source.y > smudge.viewport.y) {
    behind = vec4<f32>(0.0);
  }
  return mix(here, behind, clamp(varyings.strength * shape, 0.0, 1.0));
}
`
