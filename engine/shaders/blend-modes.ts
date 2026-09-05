import subtract from "./blend/subtract.wgsl"
import add from "./blend/add.wgsl"
import exclusion from "./blend/exclusion.wgsl"
import difference from "./blend/difference.wgsl"
import softLight from "./blend/soft-light.wgsl"
import hardLight from "./blend/hard-light.wgsl"
import colorBurn from "./blend/color-burn.wgsl"
import colorDodge from "./blend/color-dodge.wgsl"
import lighten from "./blend/lighten.wgsl"
import darken from "./blend/darken.wgsl"
import overlay from "./blend/overlay.wgsl"
import screen from "./blend/screen.wgsl"
import normal from "./blend/normal.wgsl"
import multiply from "./blend/multiply.wgsl"
import composite from "./blend/composite.wgsl"
import surface from "./blend/surface.wgsl"
import { preprocess } from "./preprocess"

/** Adding a mode only adds its snippet and registry entry, never renderer logic. */
export const blendModes = {
  normal: { label: "Normal", source: normal },
  multiply: { label: "Multiply", source: multiply },
  screen: { label: "Screen", source: screen },
  overlay: { label: "Overlay", source: overlay },
  darken: { label: "Darken", source: darken },
  lighten: { label: "Lighten", source: lighten },
  "color-dodge": { label: "Colour Dodge", source: colorDodge },
  "color-burn": { label: "Colour Burn", source: colorBurn },
  "hard-light": { label: "Hard Light", source: hardLight },
  "soft-light": { label: "Soft Light", source: softLight },
  difference: { label: "Difference", source: difference },
  exclusion: { label: "Exclusion", source: exclusion },
  add: { label: "Add", source: add },
  subtract: { label: "Subtract", source: subtract },
} as const
export type BlendMode = keyof typeof blendModes

export function blendShader(mode: BlendMode, template = surface): string {
  return preprocess(template, { mode: blendModes[mode].source, composite })
}
