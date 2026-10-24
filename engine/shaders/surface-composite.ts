import template from "./surface-composite.wgsl"
import space from "./composite-space.wgsl"
import { preprocess } from "./preprocess"

/**
 * Flattening one linear-light surface into another at an opacity, with a
 * full-screen triangle and premultiplied "over" in the pipeline's blend state.
 *
 * Two callers, one pass. The stroke buffer goes into its layer once, when the
 * pen lifts (D27) — which is why stroke opacity can be a whole-stroke
 * property: it is applied here, to the finished mark, rather than to each dab
 * as it lands. And each layer under or over the active one goes into its cache
 * at the layer's own opacity when the caches are rebuilt (D19) — read through
 * the view when the cache is on screen (sharp-zoom 01).
 *
 * No colour encoding happens here: surfaces stay linear-light, and only the
 * present pass may encode (D10).
 */
export const surfaceCompositeShader = preprocess(template, { space })
