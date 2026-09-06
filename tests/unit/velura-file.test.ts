import { describe, expect, test } from "bun:test"

import { encodeFloat16 } from "../../engine/doc/float16"
import { TILE_CHANNELS, TILE_TEXELS } from "../../engine/doc/tile-grid"
import { hashTexels } from "../../engine/doc/tile-store"
import type { DocumentManifest } from "../../engine/store/document-store"
import {
  decodeVeluraFile,
  encodeVeluraFile,
} from "../../engine/store/velura-file"

function fixture() {
  const tile = new Uint16Array(TILE_TEXELS * TILE_CHANNELS)
  tile[0] = encodeFloat16(0.75)
  const hash = hashTexels(tile)
  const manifest: DocumentManifest = {
    version: 1,
    id: "painting",
    name: "Night garden",
    width: 256,
    height: 256,
    structure: {
      layers: [
        {
          id: "group-1",
          kind: "group",
          name: "Garden",
          opacity: 0.8,
          visible: true,
          blend: "multiply",
          clip: false,
          mask: { id: "mask-1", enabled: true },
          children: [
            {
              id: "layer-1",
              kind: "raster",
              name: "Ink",
              opacity: 1,
              visible: true,
              blend: "normal",
              clip: true,
              locked: true,
            },
          ],
        },
      ],
      activeLayerId: "layer-1",
      paintingMask: false,
    },
    surfaces: [{ surfaceId: "layer-1", tiles: [{ x: 0, y: 0, hash }] }],
    updatedAt: 123,
  }
  return { tile, hash, manifest }
}

describe(".velura files", () => {
  test("round-trip the complete layer tree and exact tile pixels", async () => {
    const { tile, hash, manifest } = fixture()
    const bytes = await encodeVeluraFile(manifest, async () => tile)
    const imported = await decodeVeluraFile(bytes)

    expect(new TextDecoder().decode(bytes.subarray(0, 2))).toBe("PK")
    expect(imported.manifest).toEqual(manifest)
    expect(imported.tiles.get(hash)).toEqual(tile)
  })

  test("refuses a truncated archive rather than partially loading it", async () => {
    const { tile, manifest } = fixture()
    const bytes = await encodeVeluraFile(manifest, async () => tile)
    await expect(
      decodeVeluraFile(bytes.subarray(0, bytes.length - 12))
    ).rejects.toThrow(/truncated|valid/i)
  })

  test("refuses damage to a compressed tile", async () => {
    const { tile, manifest } = fixture()
    const bytes = await encodeVeluraFile(manifest, async () => tile)
    bytes[Math.floor(bytes.length / 2)] ^= 0xff
    await expect(decodeVeluraFile(bytes)).rejects.toThrow(
      /corrupt|damaged|tile/i
    )
  })
})
