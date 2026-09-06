/**
 * How a tile is written down (D12).
 *
 * Tiles are rgba16float and stay that way: this is a byte-exact codec, not an
 * image encoder. Half-floats survive a round trip bit for bit, including the
 * ones no image format has a place for — values above one from a wide-gamut
 * or HDR mark, and the negatives a future filter may leave behind.
 *
 * The bytes are written little-endian rather than in the host's order, so a
 * tile flushed on one machine decodes on another; that is the same blob R2
 * will hold, read back by whatever device opens the document next.
 */

const MAGIC = 0x564c5431 // "VLT1"
const HEADER_BYTES = 8

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream("deflate-raw"))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** Half-float texels as little-endian bytes, whatever this machine's order. */
function toLittleEndian(texels: Uint16Array): Uint8Array {
  const bytes = new Uint8Array(texels.length * 2)
  const view = new DataView(bytes.buffer)
  for (let i = 0; i < texels.length; i++) view.setUint16(i * 2, texels[i], true)
  return bytes
}

function fromLittleEndian(bytes: Uint8Array): Uint16Array {
  const texels = new Uint16Array(bytes.length / 2)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let i = 0; i < texels.length; i++)
    texels[i] = view.getUint16(i * 2, true)
  return texels
}

/** One tile as a blob: an 8-byte header, then the deflated texels. */
export async function encodeTile(texels: Uint16Array): Promise<Uint8Array> {
  const payload = await deflate(toLittleEndian(texels))
  const blob = new Uint8Array(HEADER_BYTES + payload.length)
  const header = new DataView(blob.buffer, 0, HEADER_BYTES)
  header.setUint32(0, MAGIC, true)
  header.setUint32(4, texels.length, true)
  blob.set(payload, HEADER_BYTES)
  return blob
}

/** The exact texels `encodeTile` was given. Anything else throws. */
export async function decodeTile(blob: Uint8Array): Promise<Uint16Array> {
  if (blob.length < HEADER_BYTES) throw new Error("A tile blob is truncated.")
  const header = new DataView(blob.buffer, blob.byteOffset, HEADER_BYTES)
  if (header.getUint32(0, true) !== MAGIC)
    throw new Error("These bytes are not a tile blob.")
  const count = header.getUint32(4, true)
  const bytes = await inflate(blob.subarray(HEADER_BYTES))
  if (bytes.length !== count * 2)
    throw new Error(
      `A tile blob holds ${bytes.length / 2} texels, not the ${count} it claims.`
    )
  return fromLittleEndian(bytes)
}
