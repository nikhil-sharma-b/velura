/**
 * Readers for the brush and pattern files GIMP defined and Krita ships (D24):
 * `.gbr` brush tips, `.gih` image hoses (several tips and a rule for picking
 * one per dab) and `.pat` patterns.
 *
 * Written from the file formats as GIMP documents them, not from either
 * application's source. They only take the bytes apart: what a texel *means*
 * — ink, or how much the paper lets through — is decided by whoever turns the
 * result into a texture, because a tip and a grain read the same pixels in
 * opposite ways.
 */

/** Pixels as the file holds them, interleaved, top row first. */
export type GimpImage = {
  name: string
  width: number
  height: number
  /** 1 grey, 2 grey and alpha, 3 RGB, 4 RGBA. */
  channels: 1 | 2 | 3 | 4
  pixels: Uint8Array
}

export type GimpBrush = GimpImage & {
  /** Distance between dabs, as a percentage of the brush's width. */
  spacing: number
}

export type GimpHose = {
  name: string
  /**
   * How the first dimension's cell is chosen per dab — `random`,
   * `incremental`, `angular`, `pressure`, `velocity` and so on — as the file
   * names it. Absent when the file does not say.
   */
  selection?: string
  cells: GimpBrush[]
}

/** Past this, a header is describing something other than a brush tip. */
const MAX_SIDE = 8192

function fail(kind: string, reason: string): never {
  throw new Error(`This ${kind} file could not be read: ${reason}.`)
}

function readName(bytes: Uint8Array, from: number, to: number): string {
  const end = bytes.indexOf(0, from)
  return new TextDecoder().decode(
    bytes.subarray(from, end === -1 || end > to ? to : end)
  )
}

function readImage(
  kind: string,
  bytes: Uint8Array,
  at: number,
  header: {
    size: number
    width: number
    height: number
    channels: number
    nameFrom: number
  }
): { image: GimpImage; end: number } {
  const { size, width, height, channels, nameFrom } = header
  if (![1, 2, 3, 4].includes(channels))
    fail(kind, `${channels} bytes per pixel is not a format it can be`)
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > MAX_SIDE ||
    height > MAX_SIDE
  )
    fail(kind, `${width}×${height} is not a size it can be`)
  const start = at + size
  const end = start + width * height * channels
  if (size < nameFrom - at || end > bytes.length)
    fail(kind, "it ends before its pixels do")
  return {
    image: {
      name: readName(bytes, nameFrom, start),
      width,
      height,
      channels: channels as GimpImage["channels"],
      pixels: bytes.slice(start, end),
    },
    end,
  }
}

function brushAt(
  bytes: Uint8Array,
  at: number
): { brush: GimpBrush; end: number } {
  if (bytes.length < at + 20) fail("brush", "it is too short")
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const size = view.getUint32(at)
  const version = view.getUint32(at + 4)
  const width = view.getUint32(at + 8)
  const height = view.getUint32(at + 12)
  const channels = view.getUint32(at + 16)
  let spacing = 25
  let nameFrom = at + 20
  if (version === 2 || version === 3) {
    if (bytes.length < at + 28 || readName(bytes, at + 20, at + 24) !== "GIMP")
      fail("brush", "it is not a GIMP brush")
    spacing = view.getUint32(at + 24)
    nameFrom = at + 28
  } else if (version !== 1) fail("brush", `version ${version} is unknown`)
  const { image, end } = readImage("brush", bytes, at, {
    size,
    width,
    height,
    channels,
    nameFrom,
  })
  return { brush: { ...image, spacing }, end }
}

export function readGbr(bytes: Uint8Array): GimpBrush {
  return brushAt(bytes, 0).brush
}

/**
 * An image hose: a name line, a parameter line whose first word is the cell
 * count, and then that many brushes back to back.
 */
export function readGih(bytes: Uint8Array): GimpHose {
  const firstBreak = bytes.indexOf(10)
  const secondBreak = firstBreak === -1 ? -1 : bytes.indexOf(10, firstBreak + 1)
  if (secondBreak === -1) fail("image hose", "its header is incomplete")
  const decoder = new TextDecoder()
  const name = decoder.decode(bytes.subarray(0, firstBreak)).trim()
  const parameters = decoder
    .decode(bytes.subarray(firstBreak + 1, secondBreak))
    .trim()
    .split(/\s+/)
  const count = Number(parameters[0])
  if (!Number.isInteger(count) || count < 1)
    fail("image hose", "it does not say how many cells it holds")
  const selection = parameters
    .find((word) => word.startsWith("sel0:"))
    ?.slice("sel0:".length)
  const cells: GimpBrush[] = []
  let at = secondBreak + 1
  for (let i = 0; i < count; i++) {
    if (at >= bytes.length)
      fail("image hose", `it holds ${i} of the ${count} cells it declares`)
    const { brush, end } = brushAt(bytes, at)
    cells.push(brush)
    at = end
  }
  return selection ? { name, selection, cells } : { name, cells }
}

export function readPat(bytes: Uint8Array): GimpImage {
  if (bytes.length < 24) fail("pattern", "it is too short")
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(4) !== 1 || readName(bytes, 20, 24) !== "GPAT")
    fail("pattern", "it is not a GIMP pattern")
  return readImage("pattern", bytes, 0, {
    size: view.getUint32(0),
    width: view.getUint32(8),
    height: view.getUint32(12),
    channels: view.getUint32(16),
    nameFrom: 24,
  }).image
}
