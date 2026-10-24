import template from "./marching-ants.wgsl"

/**
 * The selection's outline (07), drawn over the presented frame from an edge
 * test on the mask. It lands on the swap chain only: never on a layer, never
 * in an export or a readback.
 */
export const marchingAntsShader = template
