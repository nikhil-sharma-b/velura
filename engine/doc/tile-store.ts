/**
 * Content-addressed tile storage with a memory ceiling (D21).
 *
 * Undo entries are lists of hashes, not pixels, so two strokes that leave a
 * tile identical share one copy and a stroke that only touched three tiles
 * costs three tiles. What keeps a long session inside the tab's memory is the
 * tiering: the most recent tiles stay as the raw texels the GPU wants back,
 * older ones are compressed, and the oldest leave memory for disk entirely.
 *
 * The same store is what the flush cache will read from when persistence
 * lands (§9), which is why it is addressed by content rather than by step.
 */

import { TILE_BYTES } from "./tile-grid"

/** Where the oldest tiles go when memory is full. OPFS in the product. */
export interface SpillDevice {
  write(key: string, bytes: Uint8Array): Promise<void>
  read(key: string): Promise<Uint8Array>
  remove(key: string): Promise<void>
  /** How many tiles are on the device. For tests and reporting. */
  count(): number
}

export type TileTier = "hot" | "warm" | "cold" | "absent"

export interface TileStore {
  /**
   * Stores texels and returns their hash, taking one reference. Identical
   * pixels already held are not copied again; they gain a reference.
   */
  put(texels: Uint16Array): string
  /** The exact texels that were stored, from whichever tier holds them. */
  get(hash: string): Promise<Uint16Array>
  retain(hash: string): void
  /** Drops one reference; the last one takes the tile out of storage. */
  release(hash: string): void
  /** Bytes held in memory, raw and compressed together. */
  residentBytes(): number
  /** Compressed bytes that have left memory for the spill device. */
  spilledBytes(): number
  /** Logical bytes of one tile, whatever tier it is in. */
  readonly tileBytes: number
  count(): number
  tier(hash: string): TileTier
  /**
   * Finishes the compression and spilling that `put` set going. Storage is
   * correct without awaiting it; tests and shutdown await it to see the tiers
   * settled rather than in flight.
   */
  settle(): Promise<void>
}

type Entry = {
  hash: string
  refs: number
  /** Insertion or last read: what tiering treats as recency. */
  sequence: number
  raw?: Uint16Array
  compressed?: Uint8Array
  /** How many bytes of it are on the spill device, once they are. */
  spilled?: number
}

export type TileStoreOptions = {
  /** Raw texels kept in memory. Roughly "the last N entries stay instant". */
  hotBytes: number
  /** Compressed bytes kept in memory before the oldest go to disk. */
  warmBytes: number
  spill?: SpillDevice
}

/**
 * FNV-1a over the tile's bytes, twice with different offsets. One 32-bit hash
 * collides inside a single large document; two independent ones do not, and
 * both together are still one pass over memory that is already in cache.
 */
export function hashTexels(texels: Uint16Array): string {
  const bytes = new Uint8Array(
    texels.buffer,
    texels.byteOffset,
    texels.byteLength
  )
  let a = 0x811c9dc5
  let b = 0x01000193
  for (let i = 0; i < bytes.length; i++) {
    a = Math.imul(a ^ bytes[i], 0x01000193) >>> 0
    b = Math.imul(b + bytes[i] + i, 0x85ebca6b) >>> 0
  }
  return `${a.toString(16).padStart(8, "0")}${b.toString(16).padStart(8, "0")}`
}

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

/** A spill device that never leaves the tab. The fallback where OPFS is not. */
export function createMemorySpill(): SpillDevice {
  const files = new Map<string, Uint8Array>()
  return {
    async write(key, bytes) {
      files.set(key, bytes)
    },
    async read(key) {
      const bytes = files.get(key)
      if (!bytes) throw new Error(`Nothing is spilled as ${key}.`)
      return bytes
    },
    async remove(key) {
      files.delete(key)
    },
    count: () => files.size,
  }
}

/**
 * The browser's own private filesystem. Session-scoped like the history it
 * holds (D9): the directory is emptied when the store is created, so a crashed
 * tab does not leave the next one paying for its undo stack.
 */
export function createOpfsSpill(name = "velura-history"): SpillDevice {
  if (!globalThis.navigator?.storage?.getDirectory) return createMemorySpill()
  const keys = new Set<string>()
  const directory = (async () => {
    const root = await navigator.storage.getDirectory()
    await root.removeEntry(name, { recursive: true }).catch(() => {})
    return root.getDirectoryHandle(name, { create: true })
  })()
  return {
    async write(key, bytes) {
      const handle = await (
        await directory
      ).getFileHandle(key, {
        create: true,
      })
      const writable = await handle.createWritable()
      await writable.write(bytes as BufferSource)
      await writable.close()
      keys.add(key)
    },
    async read(key) {
      const handle = await (await directory).getFileHandle(key)
      return new Uint8Array(await (await handle.getFile()).arrayBuffer())
    },
    async remove(key) {
      keys.delete(key)
      await (await directory).removeEntry(key).catch(() => {})
    },
    count: () => keys.size,
  }
}

export function createTileStore(options: TileStoreOptions): TileStore {
  const entries = new Map<string, Entry>()
  const spill = options.spill
  let sequence = 0
  let hotBytes = 0
  let warmBytes = 0
  let spilledBytes = 0
  let settling: Promise<void> | undefined

  function touch(entry: Entry) {
    entry.sequence = ++sequence
  }

  /** Oldest first, so demotion always takes the least recently used tile. */
  function byAge(pool: (entry: Entry) => boolean): Entry[] {
    return [...entries.values()]
      .filter(pool)
      .sort((a, b) => a.sequence - b.sequence)
  }

  function drop(entry: Entry) {
    if (entry.raw) hotBytes -= entry.raw.byteLength
    if (entry.compressed) warmBytes -= entry.compressed.byteLength
    entries.delete(entry.hash)
    if (entry.spilled) {
      spilledBytes -= entry.spilled
      void spill?.remove(entry.hash)
    }
  }

  async function demote() {
    // Compress the oldest raw tiles until the raw pool fits its budget.
    for (const entry of byAge((entry) => !!entry.raw)) {
      if (hotBytes <= options.hotBytes) break
      const raw = entry.raw!
      const compressed = await deflate(
        new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)
      )
      // A read while compression was in flight put the tile back in the hot
      // pool, and a release took it out of storage altogether.
      if (!entries.has(entry.hash) || entry.raw !== raw) continue
      entry.raw = undefined
      entry.compressed = compressed
      hotBytes -= raw.byteLength
      warmBytes += compressed.byteLength
    }
    if (!spill) return
    for (const entry of byAge((entry) => !!entry.compressed)) {
      if (warmBytes <= options.warmBytes) break
      const compressed = entry.compressed!
      await spill.write(entry.hash, compressed)
      if (!entries.has(entry.hash) || entry.compressed !== compressed) {
        await spill.remove(entry.hash)
        continue
      }
      entry.compressed = undefined
      entry.spilled = compressed.byteLength
      spilledBytes += compressed.byteLength
      warmBytes -= compressed.byteLength
    }
  }

  function schedule() {
    settling = (settling ?? Promise.resolve()).then(demote)
    // Failures here cost memory, not pixels: the tile is still in the pool.
    void settling.catch(() => {})
  }

  return {
    tileBytes: TILE_BYTES,
    put(texels) {
      const hash = hashTexels(texels)
      const existing = entries.get(hash)
      if (existing) {
        existing.refs++
        touch(existing)
        return hash
      }
      const raw = new Uint16Array(texels)
      entries.set(hash, { hash, refs: 1, sequence: ++sequence, raw })
      hotBytes += raw.byteLength
      schedule()
      return hash
    },
    async get(hash) {
      const entry = entries.get(hash)
      if (!entry) throw new Error(`No tile is stored as ${hash}.`)
      touch(entry)
      if (entry.raw) return entry.raw
      const packed = entry.compressed ?? (await spill!.read(hash))
      const bytes = await inflate(packed)
      // Still held? Then put it back in the hot pool: a tile read once during
      // an undo is about to be read again as the artist keeps going back.
      if (entries.has(hash)) {
        const raw = new Uint16Array(
          bytes.buffer,
          bytes.byteOffset,
          bytes.byteLength / 2
        )
        entry.raw = raw
        hotBytes += raw.byteLength
        if (entry.compressed) {
          warmBytes -= entry.compressed.byteLength
          entry.compressed = undefined
        }
        if (entry.spilled) {
          spilledBytes -= entry.spilled
          entry.spilled = undefined
          void spill?.remove(hash)
        }
        schedule()
        return raw
      }
      return new Uint16Array(
        bytes.buffer,
        bytes.byteOffset,
        bytes.byteLength / 2
      )
    },
    retain(hash) {
      const entry = entries.get(hash)
      if (entry) entry.refs++
    },
    release(hash) {
      const entry = entries.get(hash)
      if (!entry) return
      if (--entry.refs <= 0) drop(entry)
    },
    residentBytes: () => hotBytes + warmBytes,
    spilledBytes: () => spilledBytes,
    count: () => entries.size,
    tier(hash) {
      const entry = entries.get(hash)
      if (!entry) return "absent"
      if (entry.raw) return "hot"
      if (entry.compressed) return "warm"
      return "cold"
    },
    async settle() {
      // Demotion can queue more demotion, so drain until it stops changing.
      while (settling) {
        const pending = settling
        await pending
        if (settling === pending) settling = undefined
      }
    },
  }
}
