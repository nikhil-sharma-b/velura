export const LAYER_FORMAT: GPUTextureFormat = "rgba16float"

/**
 * A linear-light surface. Layers, masks, the stroke buffer and everything a
 * compositor flattens are all this: what differs is only when they are
 * written, what reads them, and which space their texels are in.
 */
export type Surface = {
  id: number
  texture: GPUTexture
  view: GPUTextureView
  /**
   * A document surface, one texel per document pixel: a layer, a mask, the
   * stroke. Otherwise one a compositor drew in its own target.
   */
  document: boolean
  /** Nothing has been written since it was allocated. */
  empty: boolean
}
