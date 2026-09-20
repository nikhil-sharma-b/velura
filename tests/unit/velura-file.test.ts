import { describe, expect, test } from "bun:test"

import { encodeFloat16 } from "../../engine/doc/float16"
import { assetId } from "../../engine/doc/image-source"
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

describe("a .velura file with a placed image in it", () => {
  /** The same fixture, with an image layer that kept its original. */
  function withImage() {
    const base = fixture()
    const file = new Uint8Array([255, 216, 255, 224, 9, 9])
    const id = assetId(file)
    const layers = [
      ...base.manifest.structure.layers,
      {
        id: "layer-2",
        kind: "raster" as const,
        name: "Reference",
        opacity: 1,
        visible: true,
        blend: "normal" as const,
        clip: false,
        locked: false,
        image: true,
        placed: {
          asset: { id, mime: "image/jpeg", width: 100, height: 50 },
          placement: {
            x: 40,
            y: 30,
            width: 100,
            height: 50,
            rotation: 0.5,
            flipX: false,
            flipY: true,
          },
        },
      },
    ]
    const manifest = {
      ...base.manifest,
      structure: { ...base.manifest.structure, layers },
      assets: [{ id, mime: "image/jpeg", width: 100, height: 50 }],
    }
    return { ...base, manifest, file, id }
  }

  test("carries the original, so the picture is still movable after a round trip", async () => {
    const { tile, manifest, file, id } = withImage()
    const bytes = await encodeVeluraFile(
      manifest,
      async () => tile,
      async () => file
    )
    const imported = await decodeVeluraFile(bytes)
    expect(imported.manifest).toEqual(manifest)
    expect(imported.assets.get(id)).toEqual(file)
  })

  test("refuses an archive whose original does not match what it claims", async () => {
    const { tile, manifest, file } = withImage()
    const bytes = await encodeVeluraFile(
      manifest,
      async () => tile,
      async () => new Uint8Array([...file, 1])
    )
    await expect(decodeVeluraFile(bytes)).rejects.toThrow(/corrupt|image/i)
  })
})
