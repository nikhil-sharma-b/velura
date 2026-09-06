/**
 * The blob backend, as everything above it sees it (D11).
 *
 * Keys are content hashes for tiles and stable names for manifests; values are
 * opaque bytes. Nothing here knows what a tile is, which is the point: the
 * local implementation is OPFS today and the same interface is what R2 is
 * reached through when sync lands (§9.2), so the document store is written
 * once against both.
 */
export interface BlobStore {
  /**
   * Writes bytes under a key. Content-addressed keys make this idempotent, so
   * a caller that cannot tell whether a write happened may simply repeat it.
   */
  put(key: string, bytes: Uint8Array): Promise<void>
  /** The bytes stored under `key`, or null where nothing is. */
  get(key: string): Promise<Uint8Array | null>
  has(key: string): Promise<boolean>
  remove(key: string): Promise<void>
  /** Removes only when the current bytes exactly match `expected`. */
  compareAndRemove(key: string, expected: Uint8Array): Promise<boolean>
  /** Every key held, in no particular order. For GC and for tests. */
  keys(): Promise<string[]>
}

/** A blob store that never leaves the tab: the one tests run against. */
export function createMemoryBlobStore(): BlobStore {
  const blobs = new Map<string, Uint8Array>()
  return {
    async put(key, bytes) {
      // Copied on the way in: the caller's buffer is a view onto a tile it is
      // still free to paint over.
      blobs.set(key, new Uint8Array(bytes))
    },
    async get(key) {
      const bytes = blobs.get(key)
      return bytes ? new Uint8Array(bytes) : null
    },
    async has(key) {
      return blobs.has(key)
    },
    async remove(key) {
      blobs.delete(key)
    },
    async compareAndRemove(key, expected) {
      const current = blobs.get(key)
      if (!current || !sameBytes(current, expected)) return false
      blobs.delete(key)
      return true
    },
    async keys() {
      return [...blobs.keys()]
    },
  }
}

/** OPFS file names take a smaller alphabet than blob keys do. */
function fileName(key: string): string {
  return encodeURIComponent(key)
}

/**
 * The browser's own private filesystem, kept across sessions (D14). This is
 * the durability guarantee: a tile is on disk before the pen moves again, so
 * a crash, a force-quit and a closed tab all cost nothing.
 *
 * Unlike the history spill device, this directory is never emptied on open —
 * it is the work itself, not a session's undo stack.
 */
export function createOpfsBlobStore(name = "velura"): BlobStore {
  const directory = (async () => {
    const root = await navigator.storage.getDirectory()
    return root.getDirectoryHandle(name, { create: true })
  })()
  return {
    async put(key, bytes) {
      await withFileLock(name, key, async () => {
        const handle = await (
          await directory
        ).getFileHandle(fileName(key), {
          create: true,
        })
        const writable = await handle.createWritable()
        await writable.write(bytes as BufferSource)
        await writable.close()
      })
    },
    async get(key) {
      try {
        const handle = await (await directory).getFileHandle(fileName(key))
        return new Uint8Array(await (await handle.getFile()).arrayBuffer())
      } catch {
        // A missing file is an absent blob, which is an answer rather than a
        // failure: the caller falls through to the network, or to nothing.
        return null
      }
    },
    async has(key) {
      // Asked once per tile on the commit path, so it opens the file rather
      // than reading it: the answer is whether the blob is there, and a tile
      // is half a megabyte to buffer for a question that size.
      try {
        await (await directory).getFileHandle(fileName(key))
        return true
      } catch {
        return false
      }
    },
    async remove(key) {
      await withFileLock(name, key, async () => {
        await (await directory).removeEntry(fileName(key)).catch(() => {})
      })
    },
    async compareAndRemove(key, expected) {
      return await withFileLock(name, key, async () => {
        let current: Uint8Array
        try {
          const handle = await (await directory).getFileHandle(fileName(key))
          current = new Uint8Array(await (await handle.getFile()).arrayBuffer())
        } catch {
          return false
        }
        if (!sameBytes(current, expected)) return false
        await (await directory).removeEntry(fileName(key))
        return true
      })
    },
    async keys() {
      const handle = (await directory) as FileSystemDirectoryHandle & {
        keys(): AsyncIterableIterator<string>
      }
      const found: string[] = []
      for await (const entry of handle.keys())
        found.push(decodeURIComponent(entry))
      return found
    },
  }
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength &&
    left.every((byte, index) => byte === right[index])
  )
}

async function withFileLock<T>(
  store: string,
  key: string,
  action: () => Promise<T>
): Promise<T> {
  if (navigator.locks) {
    return await navigator.locks.request(
      `velura:${store}:${key}`,
      { mode: "exclusive" },
      action
    )
  }
  return await action()
}

/** Whether this environment can keep work across sessions on its own. */
export function opfsAvailable(): boolean {
  return typeof navigator !== "undefined" && !!navigator.storage?.getDirectory
}

/** OPFS where the browser has it, memory where it does not. */
export function createLocalBlobStore(name?: string): BlobStore {
  return opfsAvailable() ? createOpfsBlobStore(name) : createMemoryBlobStore()
}
