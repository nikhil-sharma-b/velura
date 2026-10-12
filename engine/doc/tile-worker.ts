/**
 * The tile store's work on a thread of its own (live brushes 28).
 *
 * History puts a stroke away after pen-up, and an artist does not wait for
 * it: hashing a thrown stroke's hundreds of tiles and deflating the ones past
 * the raw pool is two to three seconds that, on the main thread, the next
 * stroke's frames wait behind. Here it is a message each way. Tiles to hash
 * are transferred and handed back, so they are not copied; tiles to compress
 * are copied, since the store goes on answering reads from the raw texels
 * while their compression is in flight.
 */

import { createInlineTileWork, type TileWork } from "./tile-store"

export type TileWorkRequest =
  | { id: number; op: "digest"; tiles: ArrayBuffer[] }
  | { id: number; op: "deflate" | "inflate"; bytes: ArrayBuffer }

type DigestReply = {
  id: number
  tiles: ArrayBuffer[]
  hashes: (string | undefined)[]
}
type BytesReply = { id: number; bytes: ArrayBuffer }

export type TileWorkReply =
  | { ready: true }
  | DigestReply
  | BytesReply
  | { id: number; error: string }

type Pending = {
  resolve: (reply: TileWorkReply) => void
  reject: (error: Error) => void
}

/** A copy in a buffer of its own, which can be transferred. */
function copyToSend(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer
}

export function createTileWorker(): TileWork {
  const inline = createInlineTileWork()
  if (typeof Worker === "undefined") return inline

  let worker: Worker | undefined
  // Nothing is sent until the worker says it loaded: what is transferred to
  // one that never starts is pixels lost.
  let ready = false
  let next = 0
  const pending = new Map<number, Pending>()

  function abandon(reason: string) {
    ready = false
    worker?.terminate()
    worker = undefined
    for (const { reject } of pending.values()) reject(new Error(reason))
    pending.clear()
  }

  try {
    worker = new Worker(new URL("./tile-worker.worker.ts", import.meta.url), {
      type: "module",
    })
  } catch {
    return inline
  }
  worker.addEventListener("message", (event: MessageEvent<TileWorkReply>) => {
    const reply = event.data
    if ("ready" in reply) {
      ready = true
      return
    }
    const waiting = pending.get(reply.id)
    pending.delete(reply.id)
    if ("error" in reply) waiting?.reject(new Error(reply.error))
    else waiting?.resolve(reply)
  })
  worker.addEventListener("error", (event) => {
    event.preventDefault()
    abandon("The tile worker stopped.")
  })
  // A reply that cannot be read is a request that would wait for ever.
  worker.addEventListener("messageerror", () =>
    abandon("The tile worker's reply could not be read.")
  )

  function ask<Reply extends TileWorkReply>(
    request: TileWorkRequest,
    transfer: Transferable[]
  ): Promise<Reply> {
    return new Promise<Reply>((resolve, reject) => {
      pending.set(request.id, {
        resolve: resolve as (reply: TileWorkReply) => void,
        reject,
      })
      worker!.postMessage(request, transfer)
    })
  }

  async function recode(
    op: "deflate" | "inflate",
    bytes: Uint8Array
  ): Promise<Uint8Array> {
    if (!ready) return inline[op](bytes)
    const buffer = copyToSend(bytes)
    try {
      const reply = await ask<BytesReply>({ id: next++, op, bytes: buffer }, [
        buffer,
      ])
      return new Uint8Array(reply.bytes)
    } catch {
      // What was sent was a copy, so a worker that stopped has lost nothing:
      // an undo reading a compressed tile still gets it.
      return inline[op](bytes)
    }
  }

  return {
    async digest(tiles) {
      // A tile that is a window onto a larger buffer cannot be handed over
      // without the rest of it; none that history reads back is.
      const whole = tiles.every(
        (tile) =>
          tile.byteOffset === 0 && tile.byteLength === tile.buffer.byteLength
      )
      if (!ready || !whole) return inline.digest(tiles)
      const buffers = tiles.map((tile) => tile.buffer as ArrayBuffer)
      const reply = await ask<DigestReply>(
        { id: next++, op: "digest", tiles: buffers },
        buffers
      )
      return {
        tiles: reply.tiles.map((buffer) => new Uint16Array(buffer)),
        hashes: reply.hashes,
      }
    },
    deflate: (bytes) => recode("deflate", bytes),
    inflate: (bytes) => recode("inflate", bytes),
    dispose() {
      abandon("The tile worker was disposed of.")
    },
  }
}
