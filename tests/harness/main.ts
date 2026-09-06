import { openBlendProbe, type BlendProbe } from "./blend-probe"
import {
  buildLayerStack,
  clientMapper,
  describeEnvironment,
  markActiveLayer,
  runBenchmark,
  type RunResult,
} from "../../bench/driver"
import type { WorkloadOptions } from "../../bench/workload"
import { BRUSH_COLOR, BRUSH_FEATHER } from "../../engine/brush/round-brush"
import { createTextureLibrary } from "../../engine/brush/texture"
import { BACKGROUND } from "../../engine/doc/scene"
import { decodeFloat16 } from "../../engine/doc/float16"
import { createRenderer, type StrokeMode } from "../../engine/gpu/renderer"
import { STAMP_STRIDE } from "../../engine/gpu/stamp-instance"
import { createEngine, type Engine, type RemoteIndex } from "../../engine"
import type { DocumentStructure } from "../../engine/doc/structure"
import { createLocalBlobStore } from "../../engine/store/blob-store"
import { createDocumentStore } from "../../engine/store/document-store"
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
  /** The paper, by id, with the tile scale and how hard it bites. */
  setGrain(id: string | null, scale: number, depth: number): void
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
    describeEnvironment: typeof describeEnvironment
    /** A document of `count` layers, each holding a mark, for the compositor tests. */
    buildLayerStack(count: number): Promise<void>
    /** One short mark on whichever layer is active. */
    markActiveLayer(): Promise<void>
    /** A `RemoteIndex` backed by memory instead of Convex/R2, for 17/18 tests. */
    createFakeCloud(size: { width: number; height: number }): FakeCloud
    /** How many tiles a document's local manifest names, total, for 18's tests. */
    tileCountFor(documentId: string): Promise<number>
  }
}

window.tileCountFor = async (documentId) => {
  const store = createDocumentStore(createLocalBlobStore())
  const manifest = await store.load(documentId)
  return (
    manifest?.surfaces.reduce((sum, surface) => sum + surface.tiles.length, 0) ??
    0
  )
}

type FakeTileRow = { surfaceId: string; x: number; y: number; hash: string }

/** What a test drives beyond the plain `RemoteIndex` seam the engine sees. */
type FakeCloud = {
  remote: RemoteIndex
  /** A flush after this throws, as a brief network outage would. */
  setFailing(failing: boolean): void
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
  let structure: DocumentStructure | null = null
  let updatedAt = 0
  const tiles: FakeTileRow[] = []
  const knownHashes = new Set<string>()

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
    async commitFlush(payload) {
      if (failing) throw new Error("Simulated network outage.")
      for (const tile of payload.tiles) {
        const existing = findRow(tile.surfaceId, tile.x, tile.y)
        if (existing) existing.hash = tile.hash
        else tiles.push({ ...tile })
      }
      for (const blob of payload.uploaded) knownHashes.add(blob.hash)
      structure = payload.structure
      updatedAt = Date.now()
    },
    async documentMeta() {
      return { ...size, structure, updatedAt }
    },
    async tileIndex() {
      return tiles.map((tile) => ({ ...tile }))
    },
  }

  return {
    remote,
    setFailing: (value) => {
      failing = value
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

const canvas = document.querySelector("canvas")!
window.engine = createEngine(canvas)

window.remountEngine = (options) => {
  window.engine.dispose()
  window.engine = createEngine(canvas, options)
}

window.runBenchmark = (options) => runBenchmark(window.engine, canvas, options)
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
    setGrain: (id, scale, depth) =>
      renderer.setGrain(id ? texture(id) : null, scale, depth),
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
