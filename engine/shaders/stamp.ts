import { grainShader } from "./grain"
import { hslShader } from "./hsl"
/**
 * The stamp pass. One instanced quad per dab, drawn into the linear-light
 * target with premultiplied `over` blending — no colour encoding happens here,
 * because only the present pass is allowed to encode (D10).
 *
 * A dab's shape is either procedural — a disc with a feathered rim — or a
 * greyscale tip texture, sampled in *stamp space*: the quad is rotated and
 * squashed in the vertex stage and the texture is read from the quad's own
 * coordinates, so the tip turns and stretches with the dab for free.
 *
 * Grain is the opposite, and deliberately so (D24, §7.3): it is sampled from
 * the fragment's canvas position. `grainShader` says how.
 */
export const stampShader = /* wgsl */ `
${hslShader}
${grainShader}

const TAU = 6.283185307179586;

struct Stamp {
  // Canvas size in pixels, for the pixel -> clip space mapping.
  viewport: vec2<f32>,
  // Falloff width at the rim, in pixels.
  feather: f32,
  // One when the tip texture is the dab's shape, zero for the procedural disc.
  useTip: f32,
  // Premultiplied linear-light ink.
  color: vec4<f32>,
  // Size of one tile of the grain texture, as a multiple of its own pixels.
  grainScale: f32,
  // How strongly the paper bites, before the per-dab depth scales it.
  grainDepth: f32,
  // How much the grain travels with the dab: zero is paper fixed to the
  // canvas, one is a tooth the brush carries with it.
  grainMovement: f32,
  // One when a selection (08) clips the stroke, zero when nothing is selected.
  useSelection: f32,
}

@group(0) @binding(0) var<uniform> stamp: Stamp;
// Two samplers rather than one: a tip is clamped, so its edge cannot wrap
// round and bleed into the opposite side of the dab, and grain repeats, which
// is what lets one tile cover the whole canvas.
@group(0) @binding(1) var tipSampler: sampler;
@group(0) @binding(2) var grainSampler: sampler;
@group(0) @binding(3) var tipTexture: texture_2d_array<f32>;
@group(0) @binding(4) var grainTexture: texture_2d<f32>;
// The selection's coverage, one texel per document pixel. Read only when
// \`useSelection\` says there is one; a placeholder is bound otherwise.
@group(0) @binding(5) var selectionTexture: texture_2d<f32>;

struct Instance {
  // Dab centre in canvas pixels.
  @location(0) center: vec2<f32>,
  @location(1) radius: f32,
  @location(2) opacity: f32,
  // Rotation of the tip, as a turn clockwise.
  @location(3) angle: f32,
  // Width of the tip against its length, in (0, 1].
  @location(4) roundness: f32,
  @location(5) grainDepth: f32,
  @location(6) colorOffsets: vec3<f32>,
  @location(7) tipFrame: f32,
}

struct Varyings {
  @builtin(position) position: vec4<f32>,
  // Position within the dab, where the rim is at length 1.
  @location(0) local: vec2<f32>,
  @location(1) radius: f32,
  @location(2) opacity: f32,
  @location(3) grainDepth: f32,
  // The dab's centre in canvas pixels, so the fragment can measure its own
  // offset from it. Flat, because a centre is one value for the whole dab.
  @location(4) @interpolate(flat) center: vec2<f32>,
  @location(5) @interpolate(flat) color: vec4<f32>,
  @location(6) @interpolate(flat) tipFrame: i32,
}

@vertex
fn vertexMain(instance: Instance, @builtin(vertex_index) index: u32) -> Varyings {
  // Two triangles over the dab's bounding square.
  let corner = vec2<f32>(
    f32(index == 1u || index == 2u || index == 4u),
    f32(index == 2u || index == 4u || index == 5u)
  );
  let local = corner * 2.0 - 1.0;
  // The quad carries the tip's shape: squashed across its length by roundness,
  // then turned. Because the corners move with it, the quad still bounds the
  // dab exactly and no fragment is wasted whatever the rotation.
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
    pixel.x / stamp.viewport.x * 2.0 - 1.0,
    1.0 - pixel.y / stamp.viewport.y * 2.0,
    0.0,
    1.0
  );
  out.tipFrame = i32(instance.tipFrame);
  out.local = local;
  out.radius = instance.radius;
  out.opacity = instance.opacity;
  out.grainDepth = instance.grainDepth;
  out.center = instance.center;
  out.color = stamp.color;
  // Keep the neutral path bit-for-bit unchanged, including wide-gamut ink.
  if (any(instance.colorOffsets != vec3<f32>(0.0)) && stamp.color.a > 0.0) {
    out.color = vec4<f32>(adjustHsl(stamp.color.rgb / stamp.color.a, instance.colorOffsets) * stamp.color.a, stamp.color.a);
  }
  return out;
}

struct Fragment {
  @location(0) color: vec4<f32>,
  @builtin(frag_depth) depth: f32,
}

@fragment
fn fragmentMain(varyings: Varyings) -> Fragment {
  let distance = length(varyings.local);
  // The feather is authored in pixels, so it stays one pixel wide whatever
  // the dab's size: small dabs would otherwise be all falloff and no core.
  let edge = max(0.0, 1.0 - stamp.feather / max(varyings.radius, 1.0));
  // A hard tip must not call smoothstep with identical endpoints.
  var disc = 1.0 - step(1.0, distance);
  if (stamp.feather > 0.0) {
    disc = 1.0 - smoothstep(edge, 1.0, distance);
  }
  // Stamp space: the quad's own coordinates, so the tip turned and stretched
  // with it in the vertex stage and nothing more is needed here.
  let tip = textureSample(tipTexture, tipSampler, varyings.local * 0.5 + 0.5, varyings.tipFrame).r;
  // A tip replaces the disc rather than being cut by it, so a textured brush
  // has exactly the edge its texture draws — which is what a ragged dry tip
  // needs. A tip is expected to fall to nothing at its own rim.
  let shape = mix(disc, tip, stamp.useTip);

  // Canvas space: the paper stays where it is while the dab moves over it.
  let bite = grainBite(
    grainTexture,
    grainSampler,
    varyings.position.xy,
    varyings.center,
    stamp.grainScale,
    stamp.grainMovement,
    stamp.grainDepth * varyings.grainDepth
  );

  // The selection clips the dab where it lands, so the stroke buffer never
  // holds ink outside it: the live preview, the commit and an eraser's
  // destination-out all inherit the clip without knowing it exists.
  var selected = 1.0;
  if (stamp.useSelection > 0.0) {
    selected = textureLoad(selectionTexture, vec2<i32>(varyings.position.xy), 0).r;
  }

  let color = varyings.color * (shape * bite * varyings.opacity * selected);
  // Depth is inverse coverage. Coverage's depth test keeps the strongest
  // dab's entire colour, with later dabs winning ties. Never write empty ink.
  if (color.a <= 0.0) { discard; }
  var out: Fragment;
  out.color = color;
  out.depth = 1.0 - color.a;
  return out;
}
`
