import { assetId } from "../doc/image-source"
import {
  parseSavedScenes,
  structureSurfaceIds,
  type DocumentStructure,
} from "../doc/structure"
import { TILE_CHANNELS, TILE_TEXELS } from "../doc/tile-grid"
import { hashTexels } from "../doc/tile-store"
import { blendModes } from "../shaders/blend-modes"
import type { DocumentManifest } from "./document-store"
import { MANIFEST_VERSION } from "./document-store"
import { decodeTile, encodeTile } from "./tile-codec"

const encoder = new TextEncoder()
const decoder = new TextDecoder("utf-8", { fatal: true })
const MAX_ENTRIES = 65_535
const MAX_FILE_BYTES = 4 * 1024 * 1024 * 1024 - 1

type Entry = { name: string; bytes: Uint8Array; crc: number; offset: number }

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}

async function concat(parts: readonly Uint8Array[]): Promise<Uint8Array> {
  const length = parts.reduce((sum, part) => sum + part.length, 0)
  if (length > MAX_FILE_BYTES)
    throw new Error("This document is too large for a .velura file.")
  const result = new Uint8Array(length)
  let offset = 0
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index]
    result.set(part, offset)
    offset += part.length
    if (index % 32 === 31)
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
  return result
}

async function zip(
  entries: readonly Omit<Entry, "offset">[]
): Promise<Uint8Array> {
  if (entries.length > MAX_ENTRIES)
    throw new Error("This document has too many tiles to export.")
  const local: Uint8Array[] = []
  const indexed: Entry[] = []
  let offset = 0
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]
    const name = encoder.encode(entry.name)
    const header = new Uint8Array(30 + name.length)
    const view = new DataView(header.buffer)
    view.setUint32(0, 0x04034b50, true)
    view.setUint16(4, 20, true)
    view.setUint16(6, 0x0800, true)
    view.setUint32(14, entry.crc, true)
    view.setUint32(18, entry.bytes.length, true)
    view.setUint32(22, entry.bytes.length, true)
    view.setUint16(26, name.length, true)
    header.set(name, 30)
    local.push(header, entry.bytes)
    indexed.push({ ...entry, offset })
    offset += header.length + entry.bytes.length
    if (index % 128 === 127)
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
  const directoryOffset = offset
  const directory: Uint8Array[] = []
  for (let index = 0; index < indexed.length; index++) {
    const entry = indexed[index]
    const name = encoder.encode(entry.name)
    const header = new Uint8Array(46 + name.length)
    const view = new DataView(header.buffer)
    view.setUint32(0, 0x02014b50, true)
    view.setUint16(4, 20, true)
    view.setUint16(6, 20, true)
    view.setUint16(8, 0x0800, true)
    view.setUint32(16, entry.crc, true)
    view.setUint32(20, entry.bytes.length, true)
    view.setUint32(24, entry.bytes.length, true)
    view.setUint16(28, name.length, true)
    view.setUint32(42, entry.offset, true)
    header.set(name, 46)
    directory.push(header)
    if (index % 128 === 127)
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
  const directoryBytes = directory.reduce((sum, part) => sum + part.length, 0)
  const end = new Uint8Array(22)
  const endView = new DataView(end.buffer)
  endView.setUint32(0, 0x06054b50, true)
  endView.setUint16(8, indexed.length, true)
  endView.setUint16(10, indexed.length, true)
  endView.setUint32(12, directoryBytes, true)
  endView.setUint32(16, directoryOffset, true)
  return concat([...local, ...directory, end])
}

function unzip(bytes: Uint8Array): Map<string, Uint8Array> {
  if (bytes.length < 22) throw new Error("This .velura file is truncated.")
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let end = bytes.length - 22
  while (
    end >= Math.max(0, bytes.length - 65_557) &&
    view.getUint32(end, true) !== 0x06054b50
  )
    end--
  if (end < 0) throw new Error("This is not a valid .velura file.")
  const count = view.getUint16(end + 10, true)
  const directorySize = view.getUint32(end + 12, true)
  let cursor = view.getUint32(end + 16, true)
  if (cursor + directorySize > end)
    throw new Error("The .velura file directory is corrupt.")
  const result = new Map<string, Uint8Array>()
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > end || view.getUint32(cursor, true) !== 0x02014b50)
      throw new Error("The .velura file directory is corrupt.")
    const method = view.getUint16(cursor + 10, true)
    const crc = view.getUint32(cursor + 16, true)
    const size = view.getUint32(cursor + 20, true)
    const nameLength = view.getUint16(cursor + 28, true)
    const extraLength = view.getUint16(cursor + 30, true)
    const commentLength = view.getUint16(cursor + 32, true)
    const localOffset = view.getUint32(cursor + 42, true)
    const name = decoder.decode(
      bytes.subarray(cursor + 46, cursor + 46 + nameLength)
    )
    if (method !== 0 || name.includes("..") || name.startsWith("/"))
      throw new Error("The .velura file contains an unsupported entry.")
    if (result.has(name)) throw new Error(`The .velura file repeats ${name}.`)
    if (
      localOffset + 30 > bytes.length ||
      view.getUint32(localOffset, true) !== 0x04034b50
    )
      throw new Error("The .velura file entry is corrupt.")
    const localNameLength = view.getUint16(localOffset + 26, true)
    const localExtraLength = view.getUint16(localOffset + 28, true)
    const start = localOffset + 30 + localNameLength + localExtraLength
    if (start + size > bytes.length)
      throw new Error(`The ${name} entry is truncated.`)
    const payload = bytes.slice(start, start + size)
    if (crc32(payload) !== crc) throw new Error(`The ${name} entry is damaged.`)
    result.set(name, payload)
    cursor += 46 + nameLength + extraLength + commentLength
  }
  return result
}

function assertStructure(structure: DocumentStructure): Set<string> {
  if (
    !structure ||
    !Array.isArray(structure.layers) ||
    structure.layers.length === 0
  )
    throw new Error("The .velura manifest has no layer tree.")
  const ids = new Set<string>()
  let activeIsLeaf = false
  const walk = (nodes: DocumentStructure["layers"]) => {
    for (const node of nodes) {
      if (!node || typeof node.id !== "string" || !node.id || ids.has(node.id))
        throw new Error(
          "The .velura manifest has invalid or repeated layer ids."
        )
      ids.add(node.id)
      if (
        node.kind !== "raster" &&
        node.kind !== "vector" &&
        node.kind !== "group"
      )
        throw new Error("The .velura manifest has an unknown layer kind.")
      if (
        typeof node.name !== "string" ||
        typeof node.opacity !== "number" ||
        node.opacity < 0 ||
        node.opacity > 1 ||
        typeof node.visible !== "boolean" ||
        typeof node.clip !== "boolean" ||
        !Object.hasOwn(blendModes, node.blend)
      )
        throw new Error(`Layer ${node.id} has invalid settings.`)
      if (node.mask) {
        if (
          !node.mask.id ||
          ids.has(node.mask.id) ||
          typeof node.mask.enabled !== "boolean"
        )
          throw new Error(`Layer ${node.id} has an invalid mask.`)
        ids.add(node.mask.id)
      }
      if (node.kind === "group") {
        if (!Array.isArray(node.children))
          throw new Error(`Group ${node.id} has no children.`)
        walk(node.children)
      } else if (node.id === structure.activeLayerId) activeIsLeaf = true
    }
  }
  walk(structure.layers)
  if (!activeIsLeaf)
    throw new Error("The .velura manifest has no valid active layer.")
  return ids
}

export type ImportedVeluraFile = {
  manifest: DocumentManifest
  tiles: ReadonlyMap<string, Uint16Array>
  /** The originals placed images were made from (06), by asset id. */
  assets: ReadonlyMap<string, Uint8Array>
}

/** Creates the documented ZIP container: manifest.json plus compressed tile blobs. */
export async function encodeVeluraFile(
  manifest: DocumentManifest,
  readTile: (hash: string) => Promise<Uint16Array>,
  /** An original's own file bytes, for the assets the manifest names. */
  readAsset?: (id: string) => Promise<Uint8Array>
): Promise<Uint8Array> {
  const entries: Omit<Entry, "offset">[] = []
  const manifestBytes = encoder.encode(JSON.stringify(manifest))
  entries.push({
    name: "manifest.json",
    bytes: manifestBytes,
    crc: crc32(manifestBytes),
  })
  const hashes = [
    ...new Set(
      manifest.surfaces.flatMap((surface) =>
        surface.tiles.map((tile) => tile.hash)
      )
    ),
  ].sort()
  // Yield between tiles: encoding a large document must not monopolise the UI thread.
  for (const hash of hashes) {
    const bytes = await encodeTile(await readTile(hash))
    entries.push({ name: `tiles/${hash}.zst`, bytes, crc: crc32(bytes) })
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
  // The originals, as the files they came in as: a backup that could show a
  // photograph but not move it would not be the document.
  for (const asset of readAsset ? (manifest.assets ?? []) : []) {
    const bytes = await readAsset!(asset.id)
    entries.push({ name: `assets/${asset.id}`, bytes, crc: crc32(bytes) })
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
  return await zip(entries)
}

/** Validates every entry and tile before returning anything the engine can apply. */
export async function decodeVeluraFile(
  bytes: Uint8Array
): Promise<ImportedVeluraFile> {
  const entries = unzip(bytes)
  const manifestBytes = entries.get("manifest.json")
  if (!manifestBytes) throw new Error("This .velura file has no manifest.json.")
  let manifest: DocumentManifest
  try {
    manifest = JSON.parse(decoder.decode(manifestBytes)) as DocumentManifest
  } catch {
    throw new Error("The .velura manifest is not valid JSON.")
  }
  if (
    manifest.version !== MANIFEST_VERSION ||
    !Number.isInteger(manifest.width) ||
    !Number.isInteger(manifest.height) ||
    manifest.width < 1 ||
    manifest.height < 1 ||
    manifest.width > 8192 ||
    manifest.height > 8192 ||
    !Array.isArray(manifest.surfaces)
  )
    throw new Error(
      "The .velura manifest is invalid or from an unsupported version."
    )
  const surfaceIds = assertStructure(manifest.structure)
  // Checked whole, here, so a bad shape fails the import before the open
  // document is replaced rather than on the first redraw.
  manifest = { ...manifest, structure: parseSavedScenes(manifest.structure) }
  const tiles = new Map<string, Uint16Array>()
  const placements = new Set<string>()
  const seenSurfaces = new Set<string>()
  const maxTileX = Math.ceil(manifest.width / 256)
  const maxTileY = Math.ceil(manifest.height / 256)
  for (const surface of manifest.surfaces) {
    if (
      !surfaceIds.has(surface.surfaceId) ||
      seenSurfaces.has(surface.surfaceId) ||
      !Array.isArray(surface.tiles)
    )
      throw new Error("The .velura manifest names an unknown surface.")
    seenSurfaces.add(surface.surfaceId)
    for (const ref of surface.tiles) {
      const placement = `${surface.surfaceId}:${ref.x}:${ref.y}`
      if (
        !Number.isInteger(ref.x) ||
        !Number.isInteger(ref.y) ||
        ref.x < 0 ||
        ref.y < 0 ||
        ref.x >= maxTileX ||
        ref.y >= maxTileY ||
        typeof ref.hash !== "string" ||
        !ref.hash ||
        placements.has(placement)
      )
        throw new Error("The .velura manifest has an invalid tile placement.")
      placements.add(placement)
      if (tiles.has(ref.hash)) continue
      const blob = entries.get(`tiles/${ref.hash}.zst`)
      if (!blob)
        throw new Error(`The .velura file is missing tile ${ref.hash}.`)
      const tile = await decodeTile(blob).catch(() => {
        throw new Error(`Tile ${ref.hash} is corrupt.`)
      })
      if (
        tile.length !== TILE_TEXELS * TILE_CHANNELS ||
        hashTexels(tile) !== ref.hash
      )
        throw new Error(`Tile ${ref.hash} is corrupt.`)
      tiles.set(ref.hash, tile)
    }
  }
  const assets = new Map<string, Uint8Array>()
  for (const asset of manifest.assets ?? []) {
    if (
      typeof asset?.id !== "string" ||
      !asset.id ||
      typeof asset.mime !== "string" ||
      !Number.isInteger(asset.width) ||
      !Number.isInteger(asset.height) ||
      asset.width < 1 ||
      asset.height < 1
    )
      throw new Error("The .velura manifest has an invalid placed image.")
    const bytes = entries.get(`assets/${asset.id}`)
    // A manifest naming an original the file does not carry is a picture that
    // could be shown and not moved, which is not what this file claims to be.
    if (!bytes)
      throw new Error(`The .velura file is missing image ${asset.id}.`)
    if (assetId(bytes) !== asset.id)
      throw new Error(`Image ${asset.id} is corrupt.`)
    assets.set(asset.id, bytes)
  }
  const expected = structureSurfaceIds(manifest.structure)
  for (const surface of manifest.surfaces)
    if (!expected.has(surface.surfaceId))
      throw new Error("The .velura manifest contains an extra surface.")
  return { manifest, tiles, assets }
}
