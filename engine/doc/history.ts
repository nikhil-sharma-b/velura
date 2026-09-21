import { type DocumentStructure, sameStructure } from "./structure"
import {
  intersectRect,
  type PixelRect,
  TILE_CHANNELS,
  TILE_SIZE,
  type TileCoord,
  tileBounds,
  tileCoordFromKey,
  tileKey,
  tilesCoveringRect,
} from "./tile-grid"
import { createTileStore, type TileStore } from "./tile-store"
import {
  createUndoStack,
  type SurfaceChange,
  type UndoEntry,
} from "./undo-stack"

export type { UndoEntry } from "./undo-stack"

/**
 * What one surface holds right now, as content hashes. History keeps this
 * index in step with every upload, stroke, copy and undo, which makes it the
 * one place that already knows the document's pixels by hash — so persistence
 * reads it rather than keeping a second index of its own (§9.2).
 */
export type SurfaceTileIndex = {
  surfaceId: string
  tiles: { x: number; y: number; hash: string }[]
}

/** Tiles an operation hands over for one surface. */
export type SurfaceFill = {
  surfaceId: string
  tiles: readonly (TileCoord & { texels: Uint16Array })[]
}

/** What one discrete layer operation did to the pixels, if anything. */
export type OperationPixels = {
  /** Surfaces the operation destroyed; their pixels are kept to restore. */
  removed?: readonly string[]
  /** Surfaces the operation filled by copying another's pixels. */
  copied?: readonly { from: string; to: string }[]
  /**
   * Surfaces the operation filled with pixels of its own — a placed image
   * arrives this way. The tiles go on the GPU as part of the step, so taking
   * the step back takes the pixels with it.
   */
  filled?: readonly SurfaceFill[]
  /**
   * Surfaces whose contents the operation decided outright: after this the
   * surface holds exactly these tiles and nothing else. A transformed image
   * needs this and `filled` will not do — a picture moved to the right has to
   * stop being on the left, and a fill only ever adds.
   */
  replaced?: readonly SurfaceFill[]
  /**
   * Surfaces the operation changed on the GPU, to be read back and recorded
   * as they now are. A transformed image arrives this way: the drag drew it
   * with the renderer, so the pixels the step has to remember are the ones on
   * the GPU rather than any the caller is holding (06).
   */
  readback?: readonly { surfaceId: string; region: PixelRect }[]
  /** Canvas the filled or replaced tiles were made for; they are clipped to it. */
  canvas?: { width: number; height: number }
  /**
   * Names a run of adjustments that is one act to the artist. A dragged
   * opacity slider dispatches a command per tick, and thirty steps to undo
   * one drag would bury the stroke underneath it: consecutive operations
   * sharing a key extend the step already on the stack.
   */
  coalesceAs?: string
}

/** Texels for one tile, or null where the tile holds nothing at all. */
export type TileWrite = TileCoord & { texels: Uint16Array | null }

/**
 * The pixels an undo entry is about. The document's authoritative pixels live
 * in GPU textures, so history reads and writes them through this rather than
 * through the sparse CPU surfaces, which are only ever an upload source.
 */
export interface SurfaceBridge {
  /** Whole tiles, zero-filled outside the canvas, in the order asked for. */
  readTiles(
    surfaceId: string,
    coords: readonly TileCoord[]
  ): Promise<Uint16Array[]>
  writeTiles(surfaceId: string, tiles: readonly TileWrite[]): void
}

export interface DocumentHistory {
  /**
   * Notes the pixels a CPU surface was just uploaded with, so the first stroke
   * over them knows what it covered. No readback: these texels are the ones
   * that went to the GPU.
   */
  recordUpload(
    surfaceId: string,
    tiles: readonly (TileCoord & { texels: Uint16Array })[],
    canvas: { width: number; height: number }
  ): void
  /** One stroke, one step: reads back what the mark left in `region` (D27). */
  recordStroke(surfaceId: string, region: PixelRect): void
  /** One discrete layer operation, as the tree before and after it. */
  recordOperation(
    label: string,
    structure: { before: DocumentStructure; after: DocumentStructure },
    options?: OperationPixels
  ): void
  /**
   * Puts a whole stored state back as one step: every surface named becomes
   * exactly the tiles given, every surface not named is emptied, and the tree
   * moves with them. This is what a version restore point is applied through
   * (§9.4) — one entry, so the artist can take the restore back the way they
   * take back a stroke.
   */
  recordReplacement(
    label: string,
    structure: { before: DocumentStructure; after: DocumentStructure },
    surfaces: readonly {
      surfaceId: string
      tiles: readonly (TileCoord & { texels: Uint16Array })[]
    }[],
    canvas: { width: number; height: number }
  ): void
  undo(applyStructure: (structure: DocumentStructure) => void): Promise<boolean>
  redo(applyStructure: (structure: DocumentStructure) => void): Promise<boolean>
  canUndo(): boolean
  canRedo(): boolean
  depth(): number
  /** Steps that can still be taken back, which is where the cursor sits. */
  stepsBack(): number
  /** Logical bytes of the tiles history is keeping alive. */
  bytes(): number
  residentBytes(): number
  /** Of what history holds, how much has left memory for the spill device. */
  spilledBytes(): number
  /** Forgets everything: a resize re-tiles the document past recognition. */
  clear(): void
  /** Waits for recording that is still in flight. */
  settle(): Promise<void>
  /**
   * Every surface's tiles by content hash, as of the last recorded step. This
   * is what a document manifest is written from, and the tiles it names are
   * held in `store` until the entries naming them fall off the stack.
   */
  tileIndex(): SurfaceTileIndex[]
  /**
   * The tiles a surface holds anything in, as of the last recorded step. A
   * transparent tile is held by nothing, so a layer erased back to nothing
   * holds no tiles: this is how the list knows it is empty without reading a
   * pixel back to ask.
   */
  occupiedTiles(surfaceId: string): TileCoord[]
  readonly store: TileStore
}

/**
 * Half a gigabyte of tiles, which is a few hundred ordinary strokes and a
 * couple of dozen full-canvas washes. Only the newest of it is uncompressed
 * and only a slice of the rest is in memory at all (D21).
 */
export const DEFAULT_HISTORY_BUDGET_BYTES = 512 * 1024 * 1024
/** Roughly the ten most recent entries' worth of tiles, kept raw. */
export const DEFAULT_HOT_BYTES = 64 * 1024 * 1024
export const DEFAULT_WARM_BYTES = 128 * 1024 * 1024

const TILE_VALUES = TILE_SIZE * TILE_SIZE * TILE_CHANNELS

function isBlank(texels: Uint16Array): boolean {
  for (let i = 0; i < texels.length; i++) if (texels[i] !== 0) return false
  return true
}

/**
 * A tile as the GPU holds it: the part of it outside the canvas was never
 * written and reads back as zero, so a CPU tile has to be clipped the same way
 * before its hash can be compared with one taken from a readback.
 */
function clipTile(
  texels: Uint16Array,
  coord: TileCoord,
  canvas: { width: number; height: number }
): Uint16Array {
  const bounds = tileBounds(coord)
  const visible = intersectRect(bounds, {
    x: 0,
    y: 0,
    width: canvas.width,
    height: canvas.height,
  })
  if (!visible) return new Uint16Array(TILE_VALUES)
  if (visible.width === TILE_SIZE && visible.height === TILE_SIZE) return texels
  const clipped = new Uint16Array(TILE_VALUES)
  for (let y = 0; y < visible.height; y++) {
    const row = y * TILE_SIZE * TILE_CHANNELS
    clipped.set(texels.subarray(row, row + visible.width * TILE_CHANNELS), row)
  }
  return clipped
}

export function createDocumentHistory(options: {
  bridge: SurfaceBridge
  store?: TileStore
  budgetBytes?: number
  /** Told whenever undoing or redoing becomes possible or stops being. */
  onChange?: () => void
  /**
   * Told when recording fails. A step that cannot be recorded is a step the
   * artist cannot take back, which they have to be told about rather than
   * discover by pressing undo and watching the wrong thing happen.
   */
  onError?: (error: unknown) => void
  /**
   * Told whenever the tile index moved: a stroke recorded, an operation, an
   * upload, an undo. Persistence hangs off this rather than off the pen, so
   * every route a pixel takes into the document is a route to disk.
   */
  onCommit?: () => void
}): DocumentHistory {
  const { bridge } = options
  const store =
    options.store ??
    createTileStore({
      hotBytes: DEFAULT_HOT_BYTES,
      warmBytes: DEFAULT_WARM_BYTES,
    })
  const stack = createUndoStack({
    store,
    budgetBytes: options.budgetBytes ?? DEFAULT_HISTORY_BUDGET_BYTES,
  })
  /**
   * What each surface holds right now, by tile. This is the "before" half of
   * the next entry, and keeping it is what makes a stroke cost one readback
   * instead of two.
   */
  const index = new Map<string, Map<string, string>>()
  /** Recording is serialized: a readback must not overtake the step after it. */
  let queue: Promise<void> = Promise.resolve()
  /**
   * Bumped by `clear`. Recording queued before a clear describes a document
   * that is gone: landing it would put that document's surfaces back in the
   * index, under ids the tree that replaced it does not have.
   */
  let generation = 0

  function enqueue(
    work: (stillCurrent: () => boolean) => void | Promise<void>
  ) {
    const queuedIn = generation
    const stillCurrent = () => queuedIn === generation
    queue = queue
      .then(() => (stillCurrent() ? work(stillCurrent) : undefined))
      .catch((error) => options.onError?.(error))
  }

  function tilesOf(surfaceId: string): Map<string, string> {
    const existing = index.get(surfaceId)
    if (existing) return existing
    const created = new Map<string, string>()
    index.set(surfaceId, created)
    return created
  }

  /** Moves the index onto `hash`, whose reference it takes over. */
  function setTile(surfaceId: string, key: string, hash: string | undefined) {
    const tiles = tilesOf(surfaceId)
    const previous = tiles.get(key)
    if (previous === hash) {
      if (hash) store.release(hash)
      return
    }
    if (previous) store.release(previous)
    if (hash) tiles.set(key, hash)
    else tiles.delete(key)
  }

  /**
   * Pushes a step and lets go of the references recording was holding on the
   * pixels it displaced. The stack takes its own on the way in, so a tile the
   * document no longer shows survives exactly as long as a step names it.
   */
  function pushEntry(entry: UndoEntry) {
    // A command that left the document exactly as it found it is not a step:
    // a slider nudged back to where it started must not cost an undo.
    const empty =
      entry.surfaces.every((surface) => surface.tiles.length === 0) &&
      (!entry.structure ||
        sameStructure(entry.structure.before, entry.structure.after))
    if (!empty) stack.push(entry)
    for (const surface of entry.surfaces)
      for (const tile of surface.tiles)
        if (tile.before) store.release(tile.before)
    if (!empty) {
      options.onChange?.()
      options.onCommit?.()
    }
  }

  /** Every tile a surface currently holds, as an entry that empties it. */
  function captureRemoval(surfaceId: string): SurfaceChange {
    const tiles = index.get(surfaceId)
    const changes = [...(tiles?.entries() ?? [])].map(([key, hash]) => {
      // The entry needs its own claim on pixels the index is about to drop.
      store.retain(hash)
      return { ...tileCoordFromKey(key), before: hash }
    })
    for (const [key] of tiles ?? []) setTile(surfaceId, key, undefined)
    index.delete(surfaceId)
    return { surfaceId, tiles: changes }
  }

  /** Tiles becoming a surface's own, as the step that put them there. */
  function captureFill(
    surfaceId: string,
    tiles: readonly (TileCoord & { texels: Uint16Array })[],
    canvas: { width: number; height: number }
  ): SurfaceChange {
    const current = index.get(surfaceId)
    const changes = tiles.flatMap((tile) => {
      const clipped = clipTile(tile.texels, tile, canvas)
      if (isBlank(clipped)) return []
      const key = tileKey(tile.x, tile.y)
      const before = current?.get(key)
      const after = store.put(clipped)
      if (before === after) {
        store.release(after)
        return []
      }
      if (before) store.retain(before)
      setTile(surfaceId, key, after)
      return [{ x: tile.x, y: tile.y, before, after }]
    })
    return { surfaceId, tiles: changes }
  }

  function captureCopy(from: string, to: string): SurfaceChange {
    const source = index.get(from)
    const changes = [...(source?.entries() ?? [])].map(([key, hash]) => {
      // The copy's index needs a claim of its own on the source's pixels.
      store.retain(hash)
      setTile(to, key, hash)
      return { ...tileCoordFromKey(key), after: hash }
    })
    return { surfaceId: to, tiles: changes }
  }

  /**
   * What a region of a surface holds now, as the step that put it there.
   *
   * The pixels are read back off the GPU rather than handed over, which is
   * what a stroke needs — the mark was drawn there, not computed here — and
   * what a committed image transform needs for the same reason. Answers
   * nothing where the document was replaced during the readback.
   */
  async function captureReadback(
    surfaceId: string,
    region: PixelRect,
    stillCurrent: () => boolean
  ): Promise<SurfaceChange | undefined> {
    const coords = tilesCoveringRect(region)
    if (coords.length === 0) return undefined
    const texels = await bridge.readTiles(surfaceId, coords)
    // The readback is a wait, and the document may have been replaced
    // during it.
    if (!stillCurrent()) return undefined
    const tiles = coords.flatMap((coord, position) => {
      const key = tileKey(coord.x, coord.y)
      const before = index.get(surfaceId)?.get(key)
      const painted = texels[position]
      const after = isBlank(painted) ? undefined : store.put(painted)
      if (before === after) {
        if (after) store.release(after)
        return []
      }
      if (before) store.retain(before)
      setTile(surfaceId, key, after)
      return [{ x: coord.x, y: coord.y, before, after }]
    })
    return { surfaceId, tiles }
  }

  /**
   * A surface becoming exactly the tiles given: the ones named are written,
   * and every tile it held that they do not name is emptied. Content
   * addressing does the diffing, so a picture nudged one pixel costs the
   * tiles that actually changed rather than the whole picture.
   */
  function captureReplace(
    surfaceId: string,
    replacement: readonly (TileCoord & { texels: Uint16Array })[],
    canvas: { width: number; height: number }
  ): SurfaceChange {
    const current = index.get(surfaceId)
    const tiles: SurfaceChange["tiles"] = []
    const wanted = new Set<string>()
    for (const tile of replacement) {
      const key = tileKey(tile.x, tile.y)
      wanted.add(key)
      const clipped = clipTile(tile.texels, tile, canvas)
      const before = current?.get(key)
      const after = isBlank(clipped) ? undefined : store.put(clipped)
      if (before === after) {
        if (after) store.release(after)
        continue
      }
      if (before) store.retain(before)
      setTile(surfaceId, key, after)
      tiles.push({ x: tile.x, y: tile.y, before, after })
    }
    // What the surface holds that the replacement does not name is what the
    // operation took away: the pixels a picture left behind when it moved.
    for (const [key, hash] of [...(current ?? [])]) {
      if (wanted.has(key)) continue
      store.retain(hash)
      tiles.push({ ...tileCoordFromKey(key), before: hash })
      setTile(surfaceId, key, undefined)
    }
    return { surfaceId, tiles }
  }

  /**
   * Puts an entry's pixels on the GPU, leaving the index alone. A surface's
   * tiles are asked for together rather than one after another: at the
   * deepest tier each is a file read and an inflate, and a wash across the
   * canvas is hundreds of them. Serially, that is what would make a deep undo
   * feel slow.
   */
  async function writePixels(entry: UndoEntry, side: "before" | "after") {
    for (const surface of entry.surfaces) {
      const writes: TileWrite[] = await Promise.all(
        surface.tiles.map(async (tile) => ({
          x: tile.x,
          y: tile.y,
          texels: tile[side] ? await store.get(tile[side]!) : null,
        }))
      )
      if (writes.length > 0) bridge.writeTiles(surface.surfaceId, writes)
    }
  }

  /** Moves the index onto an entry's pixels, and puts them on the GPU. */
  async function applyPixels(entry: UndoEntry, side: "before" | "after") {
    for (const surface of entry.surfaces)
      for (const tile of surface.tiles) {
        const hash = tile[side]
        if (hash) store.retain(hash)
        setTile(surface.surfaceId, tileKey(tile.x, tile.y), hash)
      }
    await writePixels(entry, side)
  }

  return {
    store,
    recordUpload(surfaceId, tiles, canvas) {
      enqueue(() => {
        for (const tile of tiles) {
          const clipped = clipTile(tile.texels, tile, canvas)
          const key = tileKey(tile.x, tile.y)
          setTile(
            surfaceId,
            key,
            isBlank(clipped) ? undefined : store.put(clipped)
          )
        }
        options.onCommit?.()
      })
    },
    recordStroke(surfaceId, region) {
      enqueue(async (stillCurrent) => {
        const change = await captureReadback(surfaceId, region, stillCurrent)
        if (!change) return
        pushEntry({ label: "stroke", surfaces: [change] })
      })
    },
    recordReplacement(label, structure, surfaces, canvas) {
      enqueue(async () => {
        const named = new Set(surfaces.map((surface) => surface.surfaceId))
        // A surface the stored state does not have is not left as it was:
        // "how the document looked then" has to mean the layers too, or a
        // restore would leave later work stranded on a layer of its own.
        const changes: SurfaceChange[] = [...index.keys()]
          .filter((surfaceId) => !named.has(surfaceId))
          .map(captureRemoval)

        for (const surface of surfaces)
          changes.push(captureReplace(surface.surfaceId, surface.tiles, canvas))

        const entry: UndoEntry = { label, surfaces: changes, structure }
        // The index is already where the entry says it should be, so only the
        // GPU needs telling; `pushEntry` then drops the claims recording took.
        await writePixels(entry, "after")
        pushEntry(entry)
      })
    },
    recordOperation(label, structure, operation) {
      enqueue(async (stillCurrent) => {
        const canvas = operation?.canvas
        const written = [
          ...(operation?.filled ?? []).map((surface) => {
            if (!canvas)
              throw new Error("Filled surfaces need the canvas they belong to.")
            return captureFill(surface.surfaceId, surface.tiles, canvas)
          }),
          ...(operation?.replaced ?? []).map((surface) => {
            if (!canvas)
              throw new Error(
                "Replaced surfaces need the canvas they belong to."
              )
            return captureReplace(surface.surfaceId, surface.tiles, canvas)
          }),
        ]
        // Read back before the index moves under it: these pixels are already
        // on the GPU, so the step is what they now are against what the index
        // still says they were.
        const read: SurfaceChange[] = []
        for (const surface of operation?.readback ?? []) {
          const change = await captureReadback(
            surface.surfaceId,
            surface.region,
            stillCurrent
          )
          if (!change) return
          read.push(change)
        }
        const surfaces = [
          ...(operation?.removed ?? []).map(captureRemoval),
          ...(operation?.copied ?? []).map(({ from, to }) =>
            captureCopy(from, to)
          ),
          ...written,
          ...read,
        ]
        // The index already names these pixels; only the GPU needs telling.
        if (written.length > 0)
          await writePixels({ label, surfaces: written }, "after")
        const key = operation?.coalesceAs
        // Extending the step in place keeps the state it started from, which
        // is where undoing the whole run has to land.
        if (
          key &&
          surfaces.length === 0 &&
          stack.extendTop(key, structure.after)
        )
          return
        pushEntry({ label, surfaces, structure, coalesceAs: key })
      })
    },
    async undo(applyStructure) {
      await this.settle()
      const entry = stack.undo()
      if (!entry) return false
      if (entry.structure) applyStructure(entry.structure.before)
      await applyPixels(entry, "before")
      options.onChange?.()
      options.onCommit?.()
      return true
    },
    async redo(applyStructure) {
      await this.settle()
      const entry = stack.redo()
      if (!entry) return false
      if (entry.structure) applyStructure(entry.structure.after)
      await applyPixels(entry, "after")
      options.onChange?.()
      options.onCommit?.()
      return true
    },
    tileIndex: () =>
      [...index].map(([surfaceId, tiles]) => ({
        surfaceId,
        tiles: [...tiles].map(([key, hash]) => ({
          ...tileCoordFromKey(key),
          hash,
        })),
      })),
    occupiedTiles: (surfaceId) =>
      [...(index.get(surfaceId)?.keys() ?? [])].map(tileCoordFromKey),
    canUndo: () => stack.canUndo(),
    canRedo: () => stack.canRedo(),
    depth: () => stack.depth(),
    stepsBack: () => stack.stepsBack(),
    bytes: () => stack.bytes(),
    residentBytes: () => store.residentBytes(),
    spilledBytes: () => store.spilledBytes(),
    clear() {
      generation++
      stack.clear()
      for (const [surfaceId, tiles] of index)
        for (const [key] of tiles) setTile(surfaceId, key, undefined)
      index.clear()
      options.onChange?.()
    },
    async settle() {
      let pending = queue
      // Recording can queue more recording, and so can anything that runs
      // while the store settles — a stroke's pen-up lands on a frame of its
      // own. The queue is looked at last, after every wait: undo acts the
      // moment this returns, and popping past a step still being recorded
      // leaves that step's pixels on a layer the tree no longer has.
      while (true) {
        await pending
        await store.settle()
        if (pending === queue) break
        pending = queue
      }
    },
  }
}
