import { displayTransform } from "../color/display-transform"
import { decodeFloat16 } from "../doc/float16"
import { TILE_SIZE } from "../doc/tile-grid"
import type { SurfaceTiles, TileSource } from "./document-store"
import { encodeExportImage } from "./export-image"

/** Encode authoritative settled history tiles, including mask paint held only on the GPU. */
export async function svgPngImage(
  size: { width: number; height: number },
  surface: SurfaceTiles | undefined,
  read: TileSource,
  mask: boolean
): Promise<string> {
  const { width, height } = size
  const data = new Uint8Array(width * height * 4)
  if (mask) data.fill(255)
  for (const tile of surface?.tiles ?? []) {
    const texels = await read(tile.hash)
    for (let y = 0; y < Math.min(TILE_SIZE, height - tile.y * TILE_SIZE); y++) {
      for (
        let x = 0;
        x < Math.min(TILE_SIZE, width - tile.x * TILE_SIZE);
        x++
      ) {
        const from = (y * TILE_SIZE + x) * 4
        const to =
          ((tile.y * TILE_SIZE + y) * width + tile.x * TILE_SIZE + x) * 4
        const alpha = Math.max(0, Math.min(1, decodeFloat16(texels[from + 3])))
        if (mask) data[to + 3] = Math.round((1 - alpha) * 255)
        else {
          data[to + 3] = Math.round(alpha * 255)
          if (alpha > 0) {
            const color = displayTransform(
              [
                decodeFloat16(texels[from]) / alpha,
                decodeFloat16(texels[from + 1]) / alpha,
                decodeFloat16(texels[from + 2]) / alpha,
              ],
              "srgb"
            )
            for (let channel = 0; channel < 3; channel++)
              data[to + channel] = Math.round(color[channel] * 255)
          }
        }
      }
    }
  }
  const blob = await encodeExportImage(
    { ...size, data, colorSpace: "srgb" },
    { format: "png" }
  )
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ""
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
  return `data:image/png;base64,${btoa(binary)}`
}
