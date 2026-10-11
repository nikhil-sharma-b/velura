import template from "./brush-load.wgsl"
import { hslShader } from "./hsl"
import { preprocess } from "./preprocess"

/** Tint only the clean, premultiplied reservoir load, before any pickup. */
export const brushLoadShader = preprocess(template, { hsl: hslShader })
