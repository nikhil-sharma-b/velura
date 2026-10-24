import type { GrayscaleTexture } from "./texture"

/**
 * Decodes the greyscale PNGs the shipped texture library is stored as
 * (`tooling/krita-assets.ts` writes them).
 *
 * Not the browser's decoder: `createImageBitmap` and a canvas hand back
 * colour-managed RGBA, and a texel that came back one step off would move
 * where the renderer cuts the paper's tooth. Inflating the bytes ourselves
 * gives back exactly what was written, runs in a unit test, and is little
 * code because it only has to read one kind of PNG — 8-bit, single channel,
 * not interlaced — which is the only kind the pipeline writes.
 */

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]
/** Past this, a header is describing something other than a brush texture. */
const MAX_SIDE = 8192

function fail(reason: string): never {
  throw new Error(`This texture could not be decoded: ${reason}.`)
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate"))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

function paeth(left: number, up: number, upLeft: number): number {
  const p = left + up - upLeft
  const toLeft = Math.abs(p - left)
  const toUp = Math.abs(p - up)
  const toUpLeft = Math.abs(p - upLeft)
  if (toLeft <= toUp && toLeft <= toUpLeft) return left
  return toUp <= toUpLeft ? up : upLeft
}

export async function decodeGrayPng(
  bytes: Uint8Array
): Promise<GrayscaleTexture> {
  if (bytes.length < 8 || SIGNATURE.some((value, i) => bytes[i] !== value))
    fail("it is not a PNG")
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let width = 0
  let height = 0
  const compressed: Uint8Array[] = []
  for (let at = 8; at + 8 <= bytes.length;) {
    const length = view.getUint32(at)
    if (at + 12 + length > bytes.length) fail("it is cut short")
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8))
    const body = bytes.subarray(at + 8, at + 8 + length)
    if (type === "IHDR") {
      width = view.getUint32(at + 8)
      height = view.getUint32(at + 12)
      const [depth, colorType, , , interlace] = body.subarray(8, 13)
      if (depth !== 8 || colorType !== 0 || interlace !== 0)
        fail("it is not an 8-bit single-channel PNG")
      if (width > MAX_SIDE || height > MAX_SIDE)
        fail(`${width}×${height} is larger than a texture can be`)
    } else if (type === "IDAT") compressed.push(body)
    else if (type === "IEND") break
    at += 12 + length
  }
  if (!width || !height || !compressed.length) fail("it holds no image")

  const joined = new Uint8Array(compressed.reduce((n, c) => n + c.length, 0))
  let offset = 0
  for (const chunk of compressed) {
    joined.set(chunk, offset)
    offset += chunk.length
  }
  const raw = await inflate(joined)
  if (raw.length < (width + 1) * height) fail("its image data is cut short")

  // One byte per texel, so the filter's "previous pixel" is the previous byte.
  const data = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (width + 1)]
    const row = y * width
    for (let x = 0; x < width; x++) {
      const value = raw[y * (width + 1) + 1 + x]
      const left = x > 0 ? data[row + x - 1] : 0
      const up = y > 0 ? data[row - width + x] : 0
      const upLeft = x > 0 && y > 0 ? data[row - width + x - 1] : 0
      let predicted: number
      if (filter === 0) predicted = 0
      else if (filter === 1) predicted = left
      else if (filter === 2) predicted = up
      else if (filter === 3) predicted = (left + up) >> 1
      else if (filter === 4) predicted = paeth(left, up, upLeft)
      else fail(`row filter ${filter} is unknown`)
      data[row + x] = (value + predicted) & 255
    }
  }
  return { width, height, data }
}
