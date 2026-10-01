import { openBlendProbe, type BlendProbe } from "./blend-probe"
import {
  buildLayerStack,
  clientMapper,
  describeEnvironment,
  markActiveLayer,
  runBenchmark,
  runVectorBenchmark,
  type RunResult,
  type VectorRunResult,
} from "../../bench/driver"
import type { VectorWorkloadOptions } from "../../bench/vector-workload"
import type { WorkloadOptions } from "../../bench/workload"
import { BRUSH_COLOR, BRUSH_FEATHER } from "../../engine/brush/round-brush"
import { createTextureLibrary } from "../../engine/brush/texture"
import { BACKGROUND } from "../../engine/doc/scene"
import { decodeFloat16 } from "../../engine/doc/float16"
import { createRenderer, type StrokeMode } from "../../engine/gpu/renderer"
import { STAMP_STRIDE } from "../../engine/gpu/stamp-instance"
import { createEngine, type Engine, type RemoteIndex } from "../../engine"
import type { DocumentStructure } from "../../engine/doc/structure"
import { prunableVersions } from "../../convex/lib/retention"
import { createLocalBlobStore } from "../../engine/store/blob-store"
import { createDocumentStore } from "../../engine/store/document-store"
import { createCanvasImageCodec } from "../../engine/doc/image-codec"
import { encodePreview } from "../../engine/store/preview"
import { encodeExportImage } from "../../engine/store/export-image"
import { encodeTile } from "../../engine/store/tile-codec"

type EngineOptions = Parameters<typeof createEngine>[1]

/** One dab, as a test writes it. Everything past opacity has a neutral default. */
type Dab = {
  x: number
  y: number
  radius: number
  opacity: number
  angle?: number
  roundness?: number
  grainDepth?: number
}

/**
 * The renderer's stroke buffer, driven directly. Discarding stamps has no
 * pointer gesture behind it — it is what prediction (D26) will call — so the
 * tests reach the seam through this rather than through a pen.
 */
type StrokeBufferProbe = {
  beginStroke(
    accumulation: "coverage" | "buildup",
    opacity: number,
    mode?: StrokeMode
  ): void
  /** The tip texture, by id, or null for the procedural disc. */
  setTip(id: string | null): void
  /**
   * The paper, by id, with the tile scale, how hard it bites, and how much of
   * it travels with the brush instead of staying on the canvas.
   */
  setGrain(
    id: string | null,
    scale: number,
    depth: number,
    movement?: number
  ): void
  stamp(dabs: Dab[]): void
  discardStamps(count: number): boolean
  endStroke(): void
  present(): void
  /** Premultiplied linear pixels from the probe layer, before presentation. */
  readLayerPixel(x: number, y: number): Promise<number[]>
}

declare global {
  interface Window {
    openBlendProbe: typeof openBlendProbe
    blendProbe: BlendProbe
    engine: Engine
    /** A fresh engine on the same canvas, optionally with a small history. */
    remountEngine(options?: EngineOptions): void
    /** Snapshot notifications counted by the stroke tests. */
    strokeNotifications: number
    openStrokeBufferProbe(width: number, height: number): Promise<void>
    probe: StrokeBufferProbe
    /** The performance benchmark (D30), driven by `bench/run.ts`. */
    runBenchmark(options: WorkloadOptions): Promise<RunResult>
    /** Re-rasterising a vector layer of many paths (19). */
    runVectorBenchmark(options: VectorWorkloadOptions): Promise<VectorRunResult>
    describeEnvironment: typeof describeEnvironment
    /** A document of `count` layers, each holding a mark, for the compositor tests. */
    buildLayerStack(count: number): Promise<void>
    /** One short mark on whichever layer is active. */
    markActiveLayer(): Promise<void>
    /** A `RemoteIndex` backed by memory instead of Convex/R2, for 17/18 tests. */
    createFakeCloud(size: { width: number; height: number }): FakeCloud
    /** How many tiles a document's local manifest names, total, for 18's tests. */
    /** How many times a placed image's original has been decoded. */
    imageDecodes: number
    tileCountFor(documentId: string): Promise<number>
    /** Simulates one locally lost tile while leaving its manifest and cloud row intact. */
    forgetFirstLocalTile(documentId: string): Promise<void>
    /** Top-level layers in the document this device has stored. */
    layerCountFor(documentId: string): Promise<number>
    /** The placement a stored document holds for its first placed image. */
    storedPlacement(documentId: string): Promise<unknown>
    /**
     * Rewrites a stored manifest so its tree no longer names `layerId` while
     * its tiles stay listed: pixels on disk that no layer will load into.
     */
    strandLayer(documentId: string, layerId: string): Promise<void>
    encodePreview: typeof encodePreview
    encodeExportImage: typeof encodeExportImage
  }
}

window.storedPlacement = async (documentId) => {
  const store = createDocumentStore(createLocalBlobStore())
  const manifest = await store.load(documentId)
  const found = manifest?.structure.layers.find((node) => node.placed)
  return found?.placed?.placement ?? null
}

window.tileCountFor = async (documentId) => {
  const store = createDocumentStore(createLocalBlobStore())
  const manifest = await store.load(documentId)
  return (
    manifest?.surfaces.reduce(
      (sum, surface) => sum + surface.tiles.length,
      0
    ) ?? 0
  )
}

window.forgetFirstLocalTile = async (documentId) => {
  const blobs = createLocalBlobStore()
  const manifest = await createDocumentStore(blobs).load(documentId)
  const hash = manifest?.surfaces.flatMap((surface) => surface.tiles)[0]?.hash
  if (!hash) throw new Error(`No tile in ${documentId}`)
  await blobs.remove(`tiles/${hash}`)
  // Stand in for an offline local edit after the last successful cloud flush.
  await blobs.put(
    `documents/${documentId}`,
    new TextEncoder().encode(
      JSON.stringify({ ...manifest, updatedAt: Date.now() + 10_000 })
    )
  )
}

window.layerCountFor = async (documentId) => {
  const store = createDocumentStore(createLocalBlobStore())
  const manifest = await store.load(documentId)
  return manifest?.structure.layers.length ?? 0
}

window.strandLayer = async (documentId, layerId) => {
  const store = createDocumentStore(createLocalBlobStore())
  const manifest = await store.load(documentId)
  if (!manifest) throw new Error(`No document ${documentId} is stored.`)
  const layers = manifest.structure.layers.filter((node) => node.id !== layerId)
  await store.save(
    {
      ...manifest,
      structure: { ...manifest.structure, layers, activeLayerId: layers[0].id },
    },
    // Every tile the manifest names is already on the device.
    async (hash) => {
      throw new Error(`Tile ${hash} should already be stored.`)
    }
  )
}

window.encodeExportImage = encodeExportImage

type FakeTileRow = { surfaceId: string; x: number; y: number; hash: string }

/** What a test drives beyond the plain `RemoteIndex` seam the engine sees. */
type FakeCloud = {
  remote: RemoteIndex
  /** A flush after this throws, as a brief network outage would. */
  setFailing(failing: boolean): void
  /** Holds every flush's index commit this long, as a slow network would. */
  setCommitDelay(ms: number): void
  /**
   * Lands a tile straight in the cloud, bypassing this engine entirely — the
   * shape of a flush a different device made while this one was closed.
   */
  injectRemoteTile(
    surfaceId: string,
    x: number,
    y: number,
    texels: number[]
  ): Promise<void>
  /** Backdates every restore point, standing in for a passing day or week. */
  ageVersions(byMs: number): void
  /** How many previews have been committed, as `previewVersion` counts them. */
  previewVersion(): number | undefined
}

// Presigned uploads and downloads are real `fetch` PUTs and GETs in
// production (`engine/store/cloud-sync.ts`'s `fetchPut`/`fetchGet`), and the
// engine mints no override for tests to slot another transport in. Rather
// than fork that path, one URL scheme is taught to this page's own `fetch` —
// everything else still goes to the network exactly as before.
const fakeCloudBlobs = new Map<string, Uint8Array>()
const FAKE_SCHEME = "fake-cloud:"
const nativeFetch = window.fetch.bind(window)
window.fetch = (async (
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> => {
  const url = typeof input === "string" ? input : (input as Request).url
  if (!url.startsWith(FAKE_SCHEME)) return nativeFetch(input, init)
  const hash = url.slice(FAKE_SCHEME.length)
  if ((init?.method ?? "GET") === "PUT") {
    const bytes = new Uint8Array(
      await new Response(init!.body as BodyInit).arrayBuffer()
    )
    fakeCloudBlobs.set(hash, bytes)
    return new Response(null, { status: 200 })
  }
  const bytes = fakeCloudBlobs.get(hash)
  return bytes
    ? new Response(bytes as BodyInit, { status: 200 })
    : new Response(null, { status: 404 })
}) as typeof fetch

window.createFakeCloud = (size) => {
  let failing = false
  let commitDelayMs = 0
  let structure: DocumentStructure | null = null
  let updatedAt = 0
  let previewVersion: number | undefined
  const tiles: FakeTileRow[] = []
  const knownHashes = new Set<string>()
  // Restore points, as `convex/versions.ts` keeps them: the flush's own tile
  // set, thinned by the same retention rule the backend applies (§9.4).
  const versions: {
    id: string
    createdAt: number
    structure: DocumentStructure
    tiles: FakeTileRow[]
  }[] = []

  const findRow = (surfaceId: string, x: number, y: number) =>
    tiles.find((t) => t.surfaceId === surfaceId && t.x === x && t.y === y)

  const remote: RemoteIndex = {
    async missingHashes(hashes) {
      return hashes.filter((hash) => !knownHashes.has(hash))
    },
    async presignUploads(hashes) {
      return hashes.map((hash) => ({ hash, url: `${FAKE_SCHEME}${hash}` }))
    },
    async presignDownloads(hashes) {
      return hashes.map((hash) => ({ hash, url: `${FAKE_SCHEME}${hash}` }))
    },
    // The originals placed images keep travel the same way their tiles do.
    async presignAssetUploads(ids) {
      return ids.map((id) => ({ id, url: `${FAKE_SCHEME}${id}` }))
    },
    async presignAssetDownloads(ids) {
      return ids.map((id) => ({ id, url: `${FAKE_SCHEME}${id}` }))
    },
    async commitFlush(payload) {
      if (commitDelayMs > 0)
        await new Promise((resolve) => setTimeout(resolve, commitDelayMs))
      if (failing) throw new Error("Simulated network outage.")
      for (const tile of payload.tiles) {
        const existing = findRow(tile.surfaceId, tile.x, tile.y)
        if (existing) existing.hash = tile.hash
        else tiles.push({ ...tile })
      }
      // As `convex/tiles.ts` does: only the slots the flush names as removed.
      for (const slot of payload.removed) {
        const row = findRow(slot.surfaceId, slot.x, slot.y)
        if (row) tiles.splice(tiles.indexOf(row), 1)
      }
      for (const blob of payload.uploaded) knownHashes.add(blob.hash)
      structure = payload.structure
      updatedAt = Date.now()
      const now = Date.now()
      versions.push({
        id: `version-${versions.length}-${crypto.randomUUID()}`,
        createdAt: now,
        structure: payload.structure,
        tiles: payload.tiles.map((tile) => ({ ...tile })),
      })
      for (const stale of prunableVersions(versions, now))
        versions.splice(versions.indexOf(stale), 1)
    },
    // The library's preview, uploaded after the flush that it pictures.
    async presignPreviewUpload() {
      return { url: `${FAKE_SCHEME}preview`, key: "preview" }
    },
    async commitPreview() {
      previewVersion = (previewVersion ?? 0) + 1
    },
    async documentMeta() {
      return { ...size, structure, updatedAt, previewVersion }
    },
    async tileIndex() {
      return tiles.map((tile) => ({ ...tile }))
    },
    async listVersions() {
      return [...versions]
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((version) => ({ id: version.id, createdAt: version.createdAt }))
    },
    async versionSnapshot(versionId) {
      const version = versions.find((candidate) => candidate.id === versionId)
      if (!version) throw new Error("That restore point is gone.")
      return { structure: version.structure, tiles: version.tiles }
    },
  }

  return {
    remote,
    setFailing: (value) => {
      failing = value
    },
    setCommitDelay: (ms) => {
      commitDelayMs = ms
    },
    previewVersion: () => previewVersion,
    ageVersions(byMs: number) {
      for (const version of versions) version.createdAt -= byMs
    },
    async injectRemoteTile(surfaceId, x, y, texels) {
      const hash = `external-${surfaceId}-${x}-${y}-${crypto.randomUUID()}`
      fakeCloudBlobs.set(hash, await encodeTile(new Uint16Array(texels)))
      knownHashes.add(hash)
      const existing = findRow(surfaceId, x, y)
      if (existing) existing.hash = hash
      else tiles.push({ surfaceId, x, y, hash })
      // Strictly after the real flush that set `structure`, and after any
      // clock this same tick's `Date.now()` calls could return.
      updatedAt = Date.now() + 1
    },
  }
}

window.openBlendProbe = openBlendProbe
window.encodePreview = encodePreview

const canvas = document.querySelector("canvas")!
window.engine = createEngine(canvas)

window.remountEngine = (options) => {
  window.engine.dispose()
  // How many times a placed image's file has been decoded. A drag decodes
  // once however many adjustments it takes (06), and this is what says so.
  window.imageDecodes = 0
  const codec = createCanvasImageCodec()
  window.engine = createEngine(canvas, {
    ...options,
    imageCodec: {
      ...codec,
      async open(asset) {
        window.imageDecodes++
        return await codec.open(asset)
      },
    },
  })
}

window.runBenchmark = (options) => runBenchmark(window.engine, canvas, options)
window.runVectorBenchmark = (options) =>
  runVectorBenchmark(window.engine, canvas, options)
window.describeEnvironment = describeEnvironment
// The same pen the benchmark uses, so the compositor's tests and its
// measurements are driving one routine rather than two that resemble each other.
window.buildLayerStack = (count) =>
  buildLayerStack(window.engine, canvas, count)
window.markActiveLayer = () =>
  markActiveLayer(canvas, { x: 20, y: 20 }, clientMapper(canvas))

window.openStrokeBufferProbe = async (width, height) => {
  // Created on demand rather than sitting in the page: the other tests locate
  // the engine's canvas by tag, and a second one would make that ambiguous.
  const surface =
    (document.getElementById("probe") as HTMLCanvasElement | null) ??
    document.body.appendChild(document.createElement("canvas"))
  surface.id = "probe"
  surface.width = width
  surface.height = height
  const adapter = await navigator.gpu.requestAdapter()
  const device = await adapter!.requestDevice()
  const context = surface.getContext("webgpu")!
  const format = navigator.gpu.getPreferredCanvasFormat()
  context.configure({ device, format, alphaMode: "opaque" })
  const renderer = createRenderer(device, {
    // Pinned to sRGB: a golden image has to mean the same thing on every
    // machine that runs it, whatever the display can show.
    format,
    outputColorSpace: "srgb",
    background: BACKGROUND,
    ink: BRUSH_COLOR,
    feather: BRUSH_FEATHER,
  })
  renderer.resize(width, height)
  // The probe drives the stroke path alone, so its document is one empty layer
  // — enough for the compositor to have somewhere to put the mark.
  renderer.setComposition({
    below: [],
    active: { id: "probe", opacity: 1, blend: "normal", clip: false },
    above: [],
  })
  const instances = new Float32Array(1024 * STAMP_STRIDE)
  const textures = createTextureLibrary()
  const texture = (id: string) => {
    const found = textures.get(id)
    if (!found) throw new Error(`No texture is registered as ${id}.`)
    return found
  }
  window.probe = {
    beginStroke: (accumulation, opacity, mode = "paint") =>
      renderer.beginStroke({ accumulation, opacity, mode }),
    setTip: (id) => renderer.setTip(id ? texture(id) : null),
    setGrain: (id, scale, depth, movement = 0) =>
      renderer.setGrain(id ? texture(id) : null, { scale, depth, movement }),
    stamp(dabs) {
      dabs.forEach((dab, i) => {
        instances.set(
          [
            dab.x,
            dab.y,
            dab.radius,
            dab.opacity,
            dab.angle ?? 0,
            dab.roundness ?? 1,
            dab.grainDepth ?? 1,
          ],
          i * STAMP_STRIDE
        )
      })
      renderer.stamp(instances, dabs.length)
    },
    discardStamps: (count) => renderer.discardStamps(count),
    endStroke: () => renderer.endStroke(),
    present: () => renderer.render(context.getCurrentTexture().createView()),
    async readLayerPixel(x, y) {
      const tile = (await renderer.readTiles("probe", [{ x: 0, y: 0 }]))[0]
      const offset = (y * 256 + x) * 4
      return Array.from(tile.subarray(offset, offset + 4), decodeFloat16)
    },
  }
}
