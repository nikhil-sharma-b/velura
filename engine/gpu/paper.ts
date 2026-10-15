/**
 * The side of the paper in document pixels. A power of two: the shaders wrap
 * a document pixel onto it with a mask.
 */
export const PAPER_SIZE = 1024

import { DEFAULT_PAPER, type Paper } from "../doc/paper"

/**
 * How each paper is made (fluid brushes 15). `octaves` is its grain: value
 * noise at each of these sizes in document pixels, weighted so. `contrast` is
 * how far the heights are spread about the middle one, which is the paper's
 * relief. Cold press is the paper fluid brushes 07 made, to the byte; on it
 * the finest octave is one cell of the simulation, which is why the glaze
 * reads the paper at the document's resolution and not the fields'.
 */
type PaperRecipe = {
  seed: number
  octaves: readonly { cell: number; weight: number }[]
  contrast: number
}

const PAPER_RECIPES: Record<Paper, PaperRecipe> = {
  "hot-press": {
    seed: 271828,
    octaves: [
      { cell: 4, weight: 0.5 },
      { cell: 2, weight: 0.3 },
      { cell: 1, weight: 0.2 },
    ],
    contrast: 1.2,
  },
  "cold-press": {
    seed: 12345,
    octaves: [
      { cell: 8, weight: 0.5 },
      { cell: 4, weight: 0.3 },
      { cell: 2, weight: 0.2 },
    ],
    contrast: 1.8,
  },
  rough: {
    seed: 314159,
    octaves: [
      { cell: 16, weight: 0.45 },
      { cell: 8, weight: 0.3 },
      { cell: 4, weight: 0.15 },
      { cell: 2, weight: 0.1 },
    ],
    contrast: 3,
  },
}

/**
 * A paper fluid brushes paint on (D42): the height of each document pixel of
 * one tile of it, a byte from the deepest valley to the highest peak. It is
 * procedural and seeded, so it is the same paper in every session, and it
 * wraps at its edges, so it tiles without a seam.
 */
export function paperHeights(paper: Paper): Uint8Array {
  const { octaves, contrast } = PAPER_RECIPES[paper]
  let { seed } = PAPER_RECIPES[paper]
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
  }
  const sum = new Float32Array(PAPER_SIZE * PAPER_SIZE)
  for (const { cell, weight } of octaves) {
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
      Math.min(255, Math.round((0.5 + (sum[i] - 0.5) * contrast) * 255))
    )
  return heights
}

/**
 * The paper as the shaders read it: one channel, a texel a document pixel.
 * Made once, with the renderer, on the default paper; a document's own is
 * written into it by `writePaper`.
 */
export function createPaper(device: GPUDevice): GPUTexture {
  const texture = device.createTexture({
    label: "paper",
    size: { width: PAPER_SIZE, height: PAPER_SIZE },
    format: "r8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  })
  writePaper(device, texture, DEFAULT_PAPER)
  return texture
}

/**
 * Each paper's heights, made the first time it is asked for: a paper is a
 * megabyte and some tens of milliseconds to make, and a document switching
 * back and forth between two, or a picker showing all three, should not pay
 * for either again.
 */
const made = new Map<Paper, Uint8Array>()

function heightsOf(paper: Paper): Uint8Array {
  let heights = made.get(paper)
  if (!heights) made.set(paper, (heights = paperHeights(paper)))
  return heights
}

/** Writes a paper's heights into the paper texture, in place. */
export function writePaper(
  device: GPUDevice,
  texture: GPUTexture,
  paper: Paper
): void {
  device.queue.writeTexture(
    { texture },
    heightsOf(paper),
    { bytesPerRow: PAPER_SIZE },
    { width: PAPER_SIZE, height: PAPER_SIZE }
  )
}

/**
 * A square of a paper from its corner, `side` document pixels across, a
 * height a byte: what a picker shows of it.
 */
export function paperSwatch(paper: Paper, side: number): Uint8Array {
  const heights = heightsOf(paper)
  const swatch = new Uint8Array(side * side)
  for (let y = 0; y < side; y++)
    swatch.set(
      heights.subarray(y * PAPER_SIZE, y * PAPER_SIZE + side),
      y * side
    )
  return swatch
}
