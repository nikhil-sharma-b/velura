/**
 * The destructive filters (18) and their settings. Each works on a layer's
 * linear-light, premultiplied pixels on the GPU; what lives here is the part
 * that does not need one: the ranges, the settings that change nothing, and
 * the blur's weights.
 */

export type Filter =
  | {
      kind: "hsl"
      /** Degrees round the colour wheel, -180 to 180. */
      hue: number
      /** -100 greys out, 100 doubles the chroma. */
      saturation: number
      /** -100 is black, 100 is white. */
      lightness: number
    }
  | {
      kind: "brightnessContrast"
      /** -100 to 100: a shift of the linear values, by up to half. */
      brightness: number
      /** -100 flattens to middle grey, 100 doubles the spread round it. */
      contrast: number
    }
  | {
      kind: "blur"
      /** Pixels of reach either side, 0 to 100. */
      radius: number
    }

export type FilterKind = Filter["kind"]

export const FILTER_LABELS: Record<FilterKind, string> = {
  hsl: "Hue/saturation",
  brightnessContrast: "Brightness/contrast",
  blur: "Gaussian blur",
}

export const MAX_BLUR_RADIUS = 100

export function defaultFilter<K extends FilterKind>(
  kind: K
): Extract<Filter, { kind: K }>
export function defaultFilter(kind: FilterKind): Filter {
  switch (kind) {
    case "hsl":
      return { kind, hue: 0, saturation: 0, lightness: 0 }
    case "brightnessContrast":
      return { kind, brightness: 0, contrast: 0 }
    case "blur":
      return { kind, radius: 0 }
  }
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return 0
  return Math.min(max, Math.max(min, value))
}

/** Settings held to their ranges; anything not a number is left at rest. */
export function normalizeFilter<F extends Filter>(filter: F): F
export function normalizeFilter(filter: Filter): Filter {
  switch (filter.kind) {
    case "hsl":
      return {
        kind: "hsl",
        hue: clamp(filter.hue, -180, 180),
        saturation: clamp(filter.saturation, -100, 100),
        lightness: clamp(filter.lightness, -100, 100),
      }
    case "brightnessContrast":
      return {
        kind: "brightnessContrast",
        brightness: clamp(filter.brightness, -100, 100),
        contrast: clamp(filter.contrast, -100, 100),
      }
    case "blur":
      return { kind: "blur", radius: clamp(filter.radius, 0, MAX_BLUR_RADIUS) }
  }
}

/** Whether applying `filter` would leave every pixel as it is. */
export function isIdentityFilter(filter: Filter): boolean {
  const f = normalizeFilter(filter)
  switch (f.kind) {
    case "hsl":
      return f.hue === 0 && f.saturation === 0 && f.lightness === 0
    case "brightnessContrast":
      return f.brightness === 0 && f.contrast === 0
    case "blur":
      return f.radius === 0
  }
}

/**
 * One side of a normalised Gaussian, centre first: the blur runs it across
 * and then down, so the taps either side share a weight. The radius is where
 * the bell has fallen to three standard deviations, which is where it stops
 * being visible.
 */
export function blurKernel(radius: number): Float32Array {
  const reach = Math.ceil(clamp(radius, 0, MAX_BLUR_RADIUS))
  if (reach === 0) return new Float32Array([1])
  const sigma = Math.max(radius, 0.5) / 3
  const kernel = new Float32Array(reach + 1)
  let sum = 0
  for (let i = 0; i <= reach; i++) {
    kernel[i] = Math.exp(-(i * i) / (2 * sigma * sigma))
    sum += i === 0 ? kernel[i] : 2 * kernel[i]
  }
  for (let i = 0; i <= reach; i++) kernel[i] /= sum
  return kernel
}
