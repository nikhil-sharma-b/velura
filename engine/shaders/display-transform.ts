import template from "./display-transform.wgsl"
import { blendShader, type BlendMode } from "./blend-modes"

/** The only encoding pass. Blend the isolated document before its backdrop. */
export function displayTransformShader(mode: BlendMode): string {
  return blendShader(mode, template)
}
