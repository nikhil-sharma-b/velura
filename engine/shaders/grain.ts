/**
 * How much of the paper full grain depth cuts away. Below one, so the deepest
 * grain still leaves the highest peaks taking ink whole: a stroke that thinned
 * to nothing at full depth would make the top of the range unusable.
 *
 * Declared here rather than in the WGSL so the editor's preview (D32) can say
 * how much of a mark the paper takes without guessing at a number it has no
 * way to read out of a shader source string.
 */
export const GRAIN_CUT = 0.55

/**
 * The paper's bite (D24, §7.3), shared by the stamp pass and the direct pass
 * so a brush's grain reads the same wet as dry.
 *
 * Grain is sampled from the fragment's canvas position, never from the dab's,
 * so the paper stays where it is while the brush moves across it. Sampling
 * grain in stamp space is what makes texture swim with the cursor — which is
 * why grain movement, the one thing that does travel with the dab, is a
 * deliberate fraction the brush asks for rather than the accident of sampling
 * in the wrong space.
 */
export const grainShader = /* wgsl */ `
const GRAIN_CUT = ${GRAIN_CUT};
/**
 * The height of paper between taking no ink and taking it whole. Wide enough
 * that the tooth has a gradient rather than a hard threshold, which is the
 * difference between grain and a stencil.
 */
const GRAIN_SLOPE = 0.5;

// How much of a dab the paper lets through at one fragment, in [0, 1].
// \`scale\` is the size of one tile as a multiple of the texture's own pixels,
// \`movement\` how much the paper travels with the dab, and \`depth\` the bite,
// the brush's own scaled by the dab's.
fn grainBite(
  paper: texture_2d<f32>,
  paperSampler: sampler,
  position: vec2<f32>,
  center: vec2<f32>,
  scale: f32,
  movement: f32,
  depth: f32,
) -> f32 {
  // Canvas space: the fragment's position on the surface, not on the dab. The
  // stroke buffer, the layer and the document are all allocated in device
  // pixels, so this is the document pixel today. When navigation lands (D28)
  // this has to become the inverse view transform of the fragment, or the
  // paper will swim as the canvas is panned.
  // The scale is positive by the time it reaches here — the renderer refuses
  // anything else — so this does not defend against zero a second time.
  let size = vec2<f32>(textureDimensions(paper)) * scale;
  // Movement subtracts the dab's own travel from the sample position, so at
  // one the coordinate depends only on where the fragment sits *within* the
  // dab and the tooth rides along with the brush. Subtracting rather than
  // switching spaces is what makes the values between the two a drift: the
  // paper still moves under the brush, only more slowly than the brush does.
  let grain = textureSample(paper, paperSampler, (position - center * movement) / size).r;
  let clamped = clamp(depth, 0.0, 1.0);
  // The tooth is cut, not dimmed. Depth raises a threshold the paper has to
  // clear, so the valleys take no ink at all however many dabs pass over them
  // — which is what keeps a pencil reading as graphite on paper instead of
  // filling in to a flat tinted blur after a few passes.
  let cut = clamped * GRAIN_CUT;
  let carved = smoothstep(cut, min(1.0, cut + GRAIN_SLOPE), grain);
  return mix(1.0, carved, clamped);
}
`
