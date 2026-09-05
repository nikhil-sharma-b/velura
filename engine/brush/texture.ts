/**
 * The greyscale textures a brush names, and the library that resolves a name
 * to bytes (D24).
 *
 * A brush is data and carries only an id (D23, D25); the pixels are an asset,
 * looked up here. Both kinds are a single channel — a tip texture is coverage
 * and a grain texture is how much of that coverage the paper lets through — so
 * neither carries colour, and both upload as `r8unorm`.
 *
 * The built-in textures are generated rather than loaded, which is what lets a
 * golden image be reproducible on any machine and a unit test check the grain
 * without a GPU. Imported assets (D25) register through the same seam.
 */

/** A single-channel texture, one byte per texel, top row first. */
export type GrayscaleTexture = {
  readonly width: number
  readonly height: number
  readonly data: Uint8Array
}

export interface TextureLibrary {
  /** The texture under `id`, or undefined if nothing is registered there. */
  get(id: string): GrayscaleTexture | undefined
  /** Adds or replaces a texture. Imported assets arrive this way. */
  register(id: string, texture: GrayscaleTexture): void
  ids(): string[]
}

/** The speckled graphite tip: a soft disc bitten into by fine noise. */
export const GRAPHITE_TIP = "graphite"
/** The blunt charcoal tip: a broader core, coarser and more ragged. */
export const CHARCOAL_TIP = "charcoal"
/** The paper the canvas is made of, as grain. */
export const PAPER_GRAIN = "paper"

/** Big enough to read as a surface, small enough to stay a cheap upload. */
const TIP_SIZE = 128
const GRAIN_SIZE = 256

/**
 * A hash of two lattice coordinates in [0, 1). Integer arithmetic only, so the
 * same lattice cell gives the same value on every machine that runs the tests.
 */
function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1)
  h = Math.imul(h ^ (h >>> 15), 0x2545f491) ^ Math.imul(seed, 0x9e3779b1)
  h ^= h >>> 13
  return (h >>> 0) / 4294967296
}

/** The smoothstep that keeps a value-noise lattice from showing its grid. */
function fade(t: number): number {
  return t * t * (3 - 2 * t)
}

/**
 * Value noise on a lattice of `periodX` by `periodY` cells, wrapping on both
 * axes.
 *
 * Wrapping is not a detail: grain is sampled in canvas space with a repeating
 * sampler, so a lattice that did not meet itself at the edge would tile the
 * whole canvas with visible seams. It is also why anisotropy has to be a
 * difference between the two periods rather than a scale on the coordinate —
 * a scaled coordinate no longer completes a whole number of cells across the
 * texture, and the join comes back.
 */
function tileableNoise(
  x: number,
  y: number,
  periodX: number,
  periodY: number,
  seed: number
): number {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = fade(x - x0)
  const fy = fade(y - y0)
  const wrap = (value: number, period: number) =>
    ((value % period) + period) % period
  const xa = wrap(x0, periodX)
  const ya = wrap(y0, periodY)
  const xb = wrap(x0 + 1, periodX)
  const yb = wrap(y0 + 1, periodY)
  const top =
    hash2(xa, ya, seed) + (hash2(xb, ya, seed) - hash2(xa, ya, seed)) * fx
  const bottom =
    hash2(xa, yb, seed) + (hash2(xb, yb, seed) - hash2(xa, yb, seed)) * fx
  return top + (bottom - top) * fy
}

/**
 * Several octaves of wrapping value noise, in [0, 1]. Each octave doubles the
 * lattice, so every one of them wraps at the texture edge too.
 */
function fractalNoise(
  x: number,
  y: number,
  size: number,
  octaves: number,
  baseCells: number,
  seed: number,
  /** Cells across against cells down. Below one stretches the noise sideways. */
  aspect = 1
): number {
  let value = 0
  let amplitude = 1
  let total = 0
  let cells = baseCells
  for (let octave = 0; octave < octaves; octave++) {
    const cellsX = Math.max(1, Math.round(cells * aspect))
    const cellsY = cells
    value +=
      amplitude *
      tileableNoise(
        (x * cellsX) / size,
        (y * cellsY) / size,
        cellsX,
        cellsY,
        seed + octave
      )
    total += amplitude
    // Slow falloff, so the finest octaves are not drowned by the coarsest:
    // paper reads as tooth at pixel scale, not as clouds.
    amplitude *= 0.7
    cells *= 2
  }
  return value / total
}

function createTexture(
  size: number,
  texel: (x: number, y: number) => number
): GrayscaleTexture {
  const data = new Uint8Array(size * size)
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const value = texel(x, y)
      data[y * size + x] = Math.max(0, Math.min(255, Math.round(value * 255)))
    }
  return { width: size, height: size, data }
}

/**
 * A tip: coverage over the stamp's own square, falling to nothing at the rim
 * so the texture cannot draw outside the dab it belongs to. `bite` is how
 * deeply the noise cuts into the disc — none is a plain soft round tip.
 */
function createTip(
  hardness: number,
  bite: number,
  cells: number,
  seed: number
): GrayscaleTexture {
  return createTexture(TIP_SIZE, (x, y) => {
    // Texel centres, so the tip is symmetric about the middle of the square.
    const u = ((x + 0.5) / TIP_SIZE) * 2 - 1
    const v = ((y + 0.5) / TIP_SIZE) * 2 - 1
    const distance = Math.hypot(u, v)
    if (distance >= 1) return 0
    const disc = Math.min(1, (1 - distance) / Math.max(1e-3, 1 - hardness))
    const noise = fractalNoise(x, y, TIP_SIZE, 4, cells, seed)
    return disc * (1 - bite + bite * noise)
  })
}

/**
 * The paper: peaks that take ink and valleys that do not, with fibres running
 * through them.
 *
 * Stretched to the full byte range, which is not cosmetic. The renderer cuts
 * the tooth at a threshold set by grain depth, so what "deep grain" means
 * depends on where this texture's peaks and valleys actually sit; a texture
 * that used half the range would make depth mean half as much.
 */
function createPaper(): GrayscaleTexture {
  const raw = new Float64Array(GRAIN_SIZE * GRAIN_SIZE)
  let low = Infinity
  let high = -Infinity
  for (let y = 0; y < GRAIN_SIZE; y++)
    for (let x = 0; x < GRAIN_SIZE; x++) {
      // The finest octave is one cell per texel: paper has tooth at pixel
      // scale, and noise that stops short of it reads as blur, not surface.
      const speckle = fractalNoise(x, y, GRAIN_SIZE, 4, 32, 7)
      // Anisotropic noise: a fibre is longer than it is wide, which is what
      // stops the grain reading as television static.
      const fibre = fractalNoise(x, y, GRAIN_SIZE, 2, 64, 23, 0.25)
      const value = speckle * 0.6 + fibre * 0.4
      raw[y * GRAIN_SIZE + x] = value
      low = Math.min(low, value)
      high = Math.max(high, value)
    }
  const span = Math.max(1e-6, high - low)
  return createTexture(
    GRAIN_SIZE,
    (x, y) => (raw[y * GRAIN_SIZE + x] - low) / span
  )
}

/** The textures every install has, whatever it has imported. */
export function builtinTextures(): Record<string, GrayscaleTexture> {
  return {
    [GRAPHITE_TIP]: createTip(0.55, 0.75, 12, 101),
    [CHARCOAL_TIP]: createTip(0.5, 0.9, 4, 211),
    [PAPER_GRAIN]: createPaper(),
  }
}

/**
 * Rejects a texture that is not the shape the uploader assumes. Imported
 * assets are input, so they are checked once here rather than trusted at the
 * point a stroke is being drawn.
 */
export function validateTexture(texture: GrayscaleTexture): void {
  if (
    !Number.isInteger(texture?.width) ||
    !Number.isInteger(texture?.height) ||
    texture.width < 1 ||
    texture.height < 1
  )
    throw new Error("A texture must have positive integer dimensions.")
  if (texture.data.length !== texture.width * texture.height)
    throw new Error(
      "A texture must hold exactly one byte per texel, single channel."
    )
}

export function createTextureLibrary(
  initial: Record<string, GrayscaleTexture> = builtinTextures()
): TextureLibrary {
  const textures = new Map<string, GrayscaleTexture>(Object.entries(initial))
  return {
    get: (id) => textures.get(id),
    register(id, texture) {
      validateTexture(texture)
      textures.set(id, texture)
    },
    ids: () => [...textures.keys()],
  }
}
