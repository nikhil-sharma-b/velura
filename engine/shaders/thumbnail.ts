import template from "./thumbnail.wgsl"
import transfer from "./transfer.wgsl"
import { preprocess } from "./preprocess"

/**
 * One layer's pixels, shrunk to a layer-list thumbnail.
 *
 * The region holding the layer's work is fitted into the thumbnail,
 * letterboxed with transparency, so a face on a large canvas fills its
 * square instead of sitting in it as a speck. Shrinking a
 * document forty-fold would drop a thin line entirely, whether by one tap or
 * by a true average, so each thumbnail pixel reads a dense grid of taps and
 * keeps the strongest coverage among them: linework stays legible as lines.
 *
 * Colour is laid over a checkerboard, so transparent and white stay
 * different things. A mask is shown as what it lets through: white reveals,
 * black hides. Both encode for display here, as the present pass does (D10).
 */
export const thumbnailShader = preprocess(template, { transfer })
