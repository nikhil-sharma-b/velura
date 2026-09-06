/**
 * The one place the display transform is defined (D10). Present, export and
 * previews all go through it; divergence here is the classic bug that makes an
 * export look washed out beside the canvas.
 *
 * The working space is **linear Display P3**. Choosing P3 rather than Rec.709
 * primaries is what lets a wide-gamut display actually show colours sRGB
 * cannot: presenting to P3 is then a pure transfer curve, and the narrow-gamut
 * path is a real conversion that clips what will not fit.
 */

export type OutputColorSpace = "srgb" | "display-p3"

/** Row-major 3x3. */
export type ColorMatrix = readonly number[]

const IDENTITY: ColorMatrix = [1, 0, 0, 0, 1, 0, 0, 0, 1]

const P3_TO_SRGB: ColorMatrix = [
  1.2249401, -0.2249404, 0, -0.0420569, 1.0420571, 0, -0.0196376, -0.0786361,
  1.0982735,
]

const SRGB_TO_P3: ColorMatrix = [
  0.8224621, 0.177538, 0, 0.0331941, 0.9668058, 0, 0.0170827, 0.0723974,
  0.9105199,
]

/**
 * Wide gamut needs both a display that can show it and a swap chain that can
 * present it; either one missing means sRGB, correctly converted.
 */
export function chooseOutputColorSpace(support: {
  displaySupportsP3: boolean
  gpuSupportsP3: boolean
}): OutputColorSpace {
  return support.displaySupportsP3 && support.gpuSupportsP3
    ? "display-p3"
    : "srgb"
}

export function workingToOutputMatrix(output: OutputColorSpace): ColorMatrix {
  return output === "display-p3" ? IDENTITY : P3_TO_SRGB
}

/** Lifts an authored linear sRGB colour into the linear P3 working space. */
export function srgbToWorking(
  color: readonly [number, number, number]
): [number, number, number] {
  return applyMatrix(SRGB_TO_P3, color)
}

/**
 * The working space back to linear sRGB: the inverse of `srgbToWorking`, and
 * the route anything narrower than the working space has to take. The picker
 * needs it to reach Oklab, whose matrices are defined against linear sRGB.
 */
export function workingToSrgb(
  working: readonly [number, number, number]
): [number, number, number] {
  return applyMatrix(P3_TO_SRGB, working)
}

/**
 * The sRGB OETF, shared by both outputs: Display P3 uses the same curve.
 * `engine/shaders/display-transform.ts` mirrors this on the GPU; the two are
 * pinned together by the golden-image test, which renders through the shader
 * and asserts against this function.
 */
export function encodeTransfer(linear: number): number {
  const clipped = Math.min(1, Math.max(0, linear))
  return clipped <= 0.0031308
    ? clipped * 12.92
    : 1.055 * clipped ** (1 / 2.4) - 0.055
}

/** The sRGB EOTF: display-encoded value back to linear light. */
export function decodeTransfer(encoded: number): number {
  const clipped = Math.min(1, Math.max(0, encoded))
  return clipped <= 0.04045
    ? clipped / 12.92
    : ((clipped + 0.055) / 1.055) ** 2.4
}

function applyMatrix(
  matrix: ColorMatrix,
  color: readonly [number, number, number]
): [number, number, number] {
  return [0, 1, 2].map(
    (row) =>
      matrix[row * 3] * color[0] +
      matrix[row * 3 + 1] * color[1] +
      matrix[row * 3 + 2] * color[2]
  ) as [number, number, number]
}

/**
 * The CPU reference for the present shader: convert primaries, then encode.
 * Golden-image tests compare rendered pixels against this.
 */
export function displayTransform(
  workingLinear: readonly [number, number, number],
  output: OutputColorSpace
): [number, number, number] {
  return applyMatrix(workingToOutputMatrix(output), workingLinear).map(
    encodeTransfer
  ) as [number, number, number]
}
