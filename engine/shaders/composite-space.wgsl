// Where a composite is drawn (sharp-zoom 01). A compositor draws into a
// target of its own: the screen, through the view, or the document at its own
// size for export. Surfaces the compositor drew are in that target, texel for
// texel; layers, masks and the stroke are document surfaces, read through the
// view into it. The shader that includes this declares `docSampler`.
struct Composite {
  // Opacity of the whole surface, in [0, 1].
  opacity: f32,
  // Positive: the stroke in flight goes over the source at this opacity.
  // Negative: it is being painted into the source's mask instead.
  strokeOpacity: f32,
  useMask: f32,
  useClip: f32,
  // One for destination-out erasing, zero for ordinary painting.
  strokeMode: f32,
  // Whether document surfaces must be resampled: zero while the target is
  // the document itself, which is then a fetch and loses nothing.
  resample: f32,
  // Whether the source, and the clip base, are document surfaces rather than
  // ones drawn in this target.
  sourceInDoc: f32,
  clipInDoc: f32,
  // Target pixels -> document pixels.
  toDoc: mat3x3<f32>,
  docSize: vec2<f32>,
}

/**
 * A document surface at this target pixel: fetched while the target is the
 * document, and filtered through the view otherwise. Linear, as the present
 * pass always filtered. Beyond the document's edge there is nothing.
 */
fn readDocument(surface: texture_2d<f32>, position: vec2<f32>) -> vec4<f32> {
  if (composite.resample < 0.5) {
    return textureLoad(surface, vec2<i32>(position), 0);
  }
  let point = (composite.toDoc * vec3<f32>(position, 1.0)).xy;
  if (any(point < vec2<f32>(0.0)) || any(point >= composite.docSize)) {
    return vec4<f32>(0.0);
  }
  return textureSampleLevel(surface, docSampler, point / composite.docSize, 0.0);
}

/** A surface drawn in this target, or a document one read through the view. */
fn readSurface(surface: texture_2d<f32>, position: vec2<f32>, inDocument: f32) -> vec4<f32> {
  if (inDocument > 0.5) {
    return readDocument(surface, position);
  }
  return textureLoad(surface, vec2<i32>(position), 0);
}
