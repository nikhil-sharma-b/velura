import dabLocalShader from "./dab-local.wgsl"
import { grainShader } from "./grain"
import { pigmentShader } from "./pigment"

export const wetDabDescriptor = /* wgsl */ `
struct WetDab {
  center: vec2<f32>, radius: f32, strength: f32,
  origin: vec2<f32>, tipFrame: f32, flow: f32,
  size: vec2<f32>, extent: f32, directRead: f32,
  writeOffset: vec2<f32>, padding: vec2<f32>,
}
`

/**
 * Shared direct-dab mapping and paint mixing (D29, D41). Smudge reads the
 * pixel one dab's travel behind; wet brushes lay tip-space reservoir paint
 * and update that reservoir from the copied pre-dab neighbourhood. Selection
 * coverage gates deposition only. All paint is premultiplied linear RGBA.
 */
export const smudgeShader = /* wgsl */ `
${grainShader}
${pigmentShader}
${dabLocalShader}

struct Smudge {
  // Canvas size in pixels, for the pixel -> clip space mapping.
  viewport: vec2<f32>,
  // Falloff width at the rim, in pixels.
  feather: f32,
  // One when the tip texture is the dab's shape, zero for the procedural disc.
  useTip: f32,
  // One when a selection clips the smear, zero when nothing is selected.
  useSelection: f32,
  wet: f32,
  reservoirScale: f32,
  grainScale: f32,
  grainDepth: f32,
  grainMovement: f32,
  localTarget: f32,
  canonicalPickup: f32,
}

@group(0) @binding(0) var<uniform> smudge: Smudge;
@group(0) @binding(1) var tipSampler: sampler;
@group(0) @binding(2) var tipTexture: texture_2d_array<f32>;
@group(0) @binding(3) var carrySampler: sampler;
@group(0) @binding(4) var carry: texture_2d<f32>;
// The selection's coverage, one texel per document pixel. Read only when
// \`useSelection\` says there is one; a placeholder is bound otherwise.
@group(0) @binding(5) var selectionTexture: texture_2d<f32>;
@group(0) @binding(6) var grainSampler: sampler;
@group(0) @binding(7) var grainTexture: texture_2d<f32>;

@group(0) @binding(8) var reservoir: texture_2d<f32>;
@group(0) @binding(9) var destination: texture_2d<f32>;

struct Instance {
  // Dab centre in canvas pixels.
  @location(0) center: vec2<f32>,
  @location(1) radius: f32,
  // Smudge strength or wet reservoir pickup, in [0, 1].
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
  // How much reservoir paint is laid, in [0, 1].
  @location(8) flow: f32,
  // How strongly the canvas grain bites what this dab lays, in [0, 1].
  @location(9) grainDepth: f32,
}

struct Varyings {
  @builtin(position) position: vec4<f32>,
  // Position within the dab, where the rim is at length 1, interpolated
  // across the quad. The reservoir's, whose quad is the tip itself; a dab on
  // the canvas works its own out (\`dabLocal\`).
  @location(0) local: vec2<f32>,
  @location(1) @interpolate(flat) radius: f32,
  @location(2) @interpolate(flat) strength: f32,
  @location(3) @interpolate(flat) tipFrame: i32,
  @location(4) @interpolate(flat) travel: vec2<f32>,
  @location(5) @interpolate(flat) origin: vec2<f32>,
  @location(6) @interpolate(flat) flow: f32,
  @location(7) canvas: vec2<f32>,
  @location(8) @interpolate(flat) grainDepth: f32,
  @location(9) @interpolate(flat) center: vec2<f32>,
  @location(10) @interpolate(flat) angle: f32,
  @location(11) @interpolate(flat) roundness: f32,
}

// \`margin\` widens the quad by so many canvas pixels to a side.
fn dabVertex(instance: Instance, index: u32, margin: f32) -> Varyings {
  let corner = vec2<f32>(
    f32(index == 1u || index == 2u || index == 4u),
    f32(index == 2u || index == 4u || index == 5u)
  );
  let local = corner * 2.0 - 1.0;
  let shaped = local * (instance.radius * vec2<f32>(1.0, instance.roundness) + vec2<f32>(margin));
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
  out.canvas = pixel;
  out.local = local;
  out.radius = instance.radius;
  out.strength = instance.strength;
  out.tipFrame = i32(instance.tipFrame);
  out.travel = instance.travel;
  out.origin = instance.origin;
  out.flow = instance.flow;
  out.grainDepth = instance.grainDepth;
  out.center = instance.center;
  out.angle = instance.angle;
  out.roundness = instance.roundness;
  return out;
}

@vertex
fn vertexMain(instance: Instance, @builtin(vertex_index) index: u32) -> Varyings {
  // A rasteriser snaps a quad's corners to its own grid, so which pixels the
  // dab's edge takes is not left to it: the quad is drawn a pixel wide of
  // the dab and the fragment says where the dab ends.
  var out = dabVertex(instance, index, 1.0);
  if (smudge.localTarget > 0.0) {
    let corner = vec2<f32>(f32(index == 1u || index == 2u || index == 4u), f32(index == 2u || index == 4u || index == 5u));
    out.position = vec4<f32>(corner.x * 2.0 - 1.0, 1.0 - corner.y * 2.0, 0.0, 1.0);
  }
  return out;
}

fn tipCoverage(varyings: Varyings, local: vec2<f32>) -> f32 {
  let distance = length(local);
  let edge = max(0.0, 1.0 - smudge.feather / max(varyings.radius, 1.0));
  // A hard tip must not call smoothstep with identical endpoints.
  var disc = 1.0 - step(1.0, distance);
  if (smudge.feather > 0.0) {
    disc = 1.0 - smoothstep(edge, 1.0, distance);
  }
  if (smudge.useTip > 0.0) {
    let tip = textureSampleLevel(tipTexture, tipSampler, local * 0.5 + 0.5, varyings.tipFrame, 0.0).r;
    // Keep the run shader's blend arithmetic, including its rounding.
    return mix(disc, tip, smudge.useTip);
  }
  return disc;
}

@fragment
fn fragmentMain(varyings: Varyings) -> @location(0) vec4<f32> {
  // The scratch target starts at the copied neighbourhood's integer origin.
  // Recover document pixels before shape, selection, grain and paint reads.
  let pixel = varyings.position.xy + select(vec2<f32>(0.0), varyings.origin, smudge.localTarget > 0.0);
  // Paper uses implicit derivatives; sample it before any pixel returns.
  var bite = 1.0;
  if (smudge.wet > 0.0 && smudge.grainDepth > 0.0) {
    bite = grainBite(grainTexture, grainSampler, pixel,
      varyings.center, smudge.grainScale, smudge.grainMovement,
      smudge.grainDepth * varyings.grainDepth);
  }
  // As the run's compute pass has it, so the two are one smear.
  let local = dabLocal(pixel, varyings.center, varyings.angle,
    varyings.radius, varyings.roundness);
  let here = textureLoad(destination, vec2<i32>(pixel - varyings.origin), 0);
  if (!inDab(local)) {
    if (smudge.localTarget > 0.0) { return here; }
    discard;
  }
  let shape = tipCoverage(varyings, local);
  var selected = 1.0;
  if (smudge.useSelection > 0.0) {
    selected = textureLoad(selectionTexture, vec2<i32>(pixel), 0).r;
  }
  let coverage = shape * selected;
  if (smudge.wet > 0.0) {
    let amount = clamp(varyings.flow * coverage * bite, 0.0, 1.0);
    if (amount <= 0.0) { return here; }
    let paint = textureSampleLevel(reservoir, carrySampler, (local * 0.5 + 0.5) * smudge.reservoirScale, 0.0);

    return mixPaint(here, paint, amount);
  }
  // Between texels, since a dab's travel is rarely a whole pixel: without
  // the blend a slow drag would round to no travel and smear nothing.
  let source = pixel - varyings.travel;
  let size = vec2<f32>(textureDimensions(carry));
  // Held to the canvas's own texel centres: the copy stops at the canvas, and
  // what the texture holds past it is some earlier dab's.
  let within = clamp(source, vec2<f32>(0.5), smudge.viewport - vec2<f32>(0.5));
  var behind = textureSampleLevel(carry, carrySampler, (within - varyings.origin) / size, 0.0);
  // Past the canvas there is nothing, and nothing is what is dragged in.
  if (source.x < 0.0 || source.y < 0.0 || source.x > smudge.viewport.x || source.y > smudge.viewport.y) {
    behind = vec4<f32>(0.0);
  }
  let dragged = mixPaint(here, behind, clamp(varyings.strength * coverage, 0.0, 1.0));
  return dragged;
}

// Geometry changes where each bristle samples, never the stored paint.
@vertex
fn reservoirVertex(instance: Instance, @builtin(vertex_index) index: u32) -> Varyings {
  var out = dabVertex(instance, index, 0.0);
  out.position = vec4<f32>(out.local.x, -out.local.y, 0.0, 1.0);
  return out;
}

fn reservoirPaint(varyings: Varyings) -> vec4<f32> {
  let shape = tipCoverage(varyings, varyings.local);
  let uv = (varyings.local * 0.5 + 0.5) * smudge.reservoirScale;
  let paint = textureSampleLevel(reservoir, carrySampler, uv, 0.0);
  if (varyings.strength * shape <= 0.0) { return paint; }
  let pixel = varyings.canvas;
  var ground = vec4<f32>(0.0);
  if (all(pixel >= vec2<f32>(0.0)) && all(pixel < smudge.viewport)) {
    ground = textureSampleLevel(carry, carrySampler,
      (pixel - varyings.origin) / vec2<f32>(textureDimensions(carry)), 0.0);
  }
  return mixPaint(paint, ground, clamp(varyings.strength * shape, 0.0, 1.0));
}
@fragment
fn reservoirFragment(varyings: Varyings) -> @location(0) vec4<f32> {
  var sample = varyings;
  if (smudge.canonicalPickup > 0.0 && smudge.useTip == 0.0 && varyings.angle == 0.0 && varyings.roundness == 1.0) {
    // The render and compute paths derive the same bristle from its texel,
    // rather than depending on the rasterizer's varying interpolation.
    let extent = smudge.reservoirScale * f32(textureDimensions(reservoir).x);
    sample.local = varyings.position.xy / extent * 2.0 - 1.0;
    sample.canvas = varyings.center + sample.local * varyings.radius;
  }
  return reservoirPaint(sample);
}
${wetDabDescriptor}
@group(0) @binding(10) var pickedUp: texture_storage_2d<rgba16float, write>;
@group(0) @binding(11) var<uniform> wetDab: WetDab;
@group(0) @binding(12) var deposited: texture_storage_2d<rgba16float, write>;
// An aligned procedural dab without paper works both targets in one compute pass.
@compute @workgroup_size(16, 8)
fn wetDabMain(@builtin(global_invocation_id) id: vec3<u32>) {
  var sample: Varyings;
  sample.radius = wetDab.radius;
  sample.strength = wetDab.strength;
  sample.origin = select(wetDab.origin, vec2<f32>(0.0), wetDab.directRead > 0.0);
  sample.center = wetDab.center;
  sample.roundness = 1.0;
  if (all(vec2<f32>(id.xy) < wetDab.size)) {
    let stored = vec2<f32>(id.xy) + wetDab.writeOffset;
    let pixel = wetDab.origin + stored + vec2<f32>(0.5);
    let local = dabLocal(pixel, wetDab.center, 0.0, wetDab.radius, 1.0);
    let here = textureLoad(carry, vec2<i32>(select(stored, pixel, wetDab.directRead > 0.0)), 0);
    var result = here;
    if (inDab(local)) {
      var selected = 1.0;
      if (smudge.useSelection > 0.0) {
        selected = textureLoad(selectionTexture, vec2<i32>(pixel), 0).r;
      }
      let amount = clamp(wetDab.flow * tipCoverage(sample, local) * selected, 0.0, 1.0);
      if (amount > 0.0) {
        let paint = textureSampleLevel(reservoir, carrySampler, (local * 0.5 + 0.5) * smudge.reservoirScale, 0.0);
        result = mixPaint(here, paint, amount);
      }
    }
    textureStore(deposited, vec2<i32>(stored), result);
  }

}
fn pickupTexel(position: vec2<f32>) -> vec4<f32> {
  var sample: Varyings;
  sample.radius = wetDab.radius;
  sample.strength = wetDab.strength;
  sample.origin = select(wetDab.origin, vec2<f32>(0.0), wetDab.directRead > 0.0);
  sample.center = wetDab.center;
  sample.roundness = 1.0;
  sample.local = position / wetDab.extent * 2.0 - 1.0;
  sample.canvas = wetDab.center + sample.local * wetDab.radius;
  return reservoirPaint(sample);
}
@compute @workgroup_size(16, 8)
fn pickupMain(@builtin(global_invocation_id) id: vec3<u32>) {
  if (any(vec2<f32>(id.xy) >= vec2<f32>(wetDab.extent))) { return; }
  textureStore(pickedUp, vec2<i32>(id.xy), pickupTexel(vec2<f32>(id.xy) + vec2<f32>(0.5)));

}

`
