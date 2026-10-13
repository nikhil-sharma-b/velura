/**
 * The side of the paper in document pixels. A power of two: the shaders wrap
 * a document pixel onto it with a mask.
 */
export const PAPER_SIZE = 1024

/**
 * The paper's grain: value noise at each of these sizes in document pixels,
 * weighted so. The finest is one cell of the simulation, which is why the
 * glaze reads the paper at the document's resolution and not the fields'.
 */
const OCTAVES = [
  { cell: 8, weight: 0.5 },
  { cell: 4, weight: 0.3 },
  { cell: 2, weight: 0.2 },
] as const

/** How far the heights are spread about the middle one. */
const CONTRAST = 1.8

/**
 * The paper every fluid brush paints on (D42): the height of each document
 * pixel of one tile of it, a byte from the deepest valley to the highest
 * peak. It is procedural and seeded, so it is the same paper in every
 * session, and it wraps at its edges, so it tiles without a seam.
 */
export function paperHeights(): Uint8Array {
  let seed = 12345
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
  }
  const sum = new Float32Array(PAPER_SIZE * PAPER_SIZE)
  for (const { cell, weight } of OCTAVES) {
    const side = PAPER_SIZE / cell
    const lattice = Float32Array.from({ length: side * side }, random)
    for (let y = 0; y < PAPER_SIZE; y++) {
      const row = Math.floor(y / cell)
      const ty = y / cell - row
      const sy = ty * ty * (3 - 2 * ty)
      const upper = row * side
      const lower = ((row + 1) % side) * side
      for (let x = 0; x < PAPER_SIZE; x++) {
        const column = Math.floor(x / cell)
        const tx = x / cell - column
        const sx = tx * tx * (3 - 2 * tx)
        const next = (column + 1) % side
        const above =
          lattice[upper + column] * (1 - sx) + lattice[upper + next] * sx
        const below =
          lattice[lower + column] * (1 - sx) + lattice[lower + next] * sx
        sum[y * PAPER_SIZE + x] += weight * (above * (1 - sy) + below * sy)
      }
    }
  }
  const heights = new Uint8Array(sum.length)
  for (let i = 0; i < sum.length; i++)
    heights[i] = Math.max(
      0,
      Math.min(255, Math.round((0.5 + (sum[i] - 0.5) * CONTRAST) * 255))
    )
  return heights
}

/** The paper as the shaders read it: one channel, a texel a document pixel. */
export function createPaper(device: GPUDevice): GPUTexture {
  const texture = device.createTexture({
    label: "paper",
    size: { width: PAPER_SIZE, height: PAPER_SIZE },
    format: "r8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  })
  device.queue.writeTexture(
    { texture },
    paperHeights(),
    { bytesPerRow: PAPER_SIZE },
    { width: PAPER_SIZE, height: PAPER_SIZE }
  )
  return texture
}
