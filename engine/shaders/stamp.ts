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
 * Grain is the opposite, and deliberately so (D24, §7.3). It is sampled from
 * the fragment's canvas position, never from the dab's, so the paper stays
 * where it is while the brush moves across it. Sampling grain in stamp space
 * is what makes texture swim with the cursor.
 */
export const stampShader = /* wgsl */ `
const TAU = 6.283185307179586;

/**
 * How much of the paper full grain depth cuts away. Below one, so the deepest
 * grain still leaves the highest peaks taking ink whole: a stroke that thinned
 * to nothing at full depth would make the top of the range unusable.
 */
const GRAIN_CUT = 0.55;
/**
 * The height of paper between taking no ink and taking it whole. Wide enough
 * that the tooth has a gradient rather than a hard threshold, which is the
 * difference between grain and a stencil.
 */
const GRAIN_SLOPE = 0.5;

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
  padding: vec2<f32>,
}

@group(0) @binding(0) var<uniform> stamp: Stamp;
// Two samplers rather than one: a tip is clamped, so its edge cannot wrap
// round and bleed into the opposite side of the dab, and grain repeats, which
// is what lets one tile cover the whole canvas.
@group(0) @binding(1) var tipSampler: sampler;
@group(0) @binding(2) var grainSampler: sampler;
@group(0) @binding(3) var tipTexture: texture_2d<f32>;
@group(0) @binding(4) var grainTexture: texture_2d<f32>;

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
}

struct Varyings {
  @builtin(position) position: vec4<f32>,
  // Position within the dab, where the rim is at length 1.
  @location(0) local: vec2<f32>,
  @location(1) radius: f32,
  @location(2) opacity: f32,
  @location(3) grainDepth: f32,
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
  out.local = local;
  out.radius = instance.radius;
  out.opacity = instance.opacity;
  out.grainDepth = instance.grainDepth;
  return out;
}

@fragment
fn fragmentMain(varyings: Varyings) -> @location(0) vec4<f32> {
  let distance = length(varyings.local);
  // The feather is authored in pixels, so it stays one pixel wide whatever
  // the dab's size: small dabs would otherwise be all falloff and no core.
  let edge = max(0.0, 1.0 - stamp.feather / max(varyings.radius, 1.0));
  let disc = 1.0 - smoothstep(edge, 1.0, distance);
  // Stamp space: the quad's own coordinates, so the tip turned and stretched
  // with it in the vertex stage and nothing more is needed here.
  let tip = textureSample(tipTexture, tipSampler, varyings.local * 0.5 + 0.5).r;
  // A tip replaces the disc rather than being cut by it, so a textured brush
  // has exactly the edge its texture draws — which is what a ragged dry tip
  // needs. A tip is expected to fall to nothing at its own rim.
  let shape = mix(disc, tip, stamp.useTip);

  // Canvas space: the fragment's position on the surface, not on the dab. The
  // stroke buffer, the layer and the document are all allocated in device
  // pixels, so this is the document pixel today. When navigation lands (D28)
  // this has to become the inverse view transform of the fragment, or the
  // paper will swim as the canvas is panned.
  // The scale is positive by the time it reaches here — the renderer refuses
  // anything else — so this does not defend against zero a second time.
  let grainSize = vec2<f32>(textureDimensions(grainTexture)) * stamp.grainScale;
  let grain = textureSample(grainTexture, grainSampler, varyings.position.xy / grainSize).r;
  let depth = clamp(stamp.grainDepth * varyings.grainDepth, 0.0, 1.0);
  // The tooth is cut, not dimmed. Depth raises a threshold the paper has to
  // clear, so the valleys take no ink at all however many dabs pass over them
  // — which is what keeps a pencil reading as graphite on paper instead of
  // filling in to a flat tinted blur after a few passes.
  let cut = depth * GRAIN_CUT;
  let carved = smoothstep(cut, min(1.0, cut + GRAIN_SLOPE), grain);
  let bite = mix(1.0, carved, depth);

  return stamp.color * (shape * bite * varyings.opacity);
}
`
