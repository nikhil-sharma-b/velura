/**
 * The other end of `createTileWorker`: hashes, deflates and inflates tiles
 * off the thread the pen is on (live brushes 28).
 */

import { deflate, digestTexels, inflate } from "./tile-store"
import type { TileWorkReply, TileWorkRequest } from "./tile-worker"

function reply(message: TileWorkReply, transfer: Transferable[] = []) {
  self.postMessage(message, { transfer })
}

async function answer(request: TileWorkRequest): Promise<void> {
  if (request.op === "digest") {
    const hashes = request.tiles.map((tile) =>
      digestTexels(new Uint16Array(tile))
    )
    reply({ id: request.id, tiles: request.tiles, hashes }, request.tiles)
    return
  }
  const bytes = new Uint8Array(request.bytes)
  const done = await (request.op === "deflate" ? deflate : inflate)(bytes)
  reply({ id: request.id, bytes: done.buffer as ArrayBuffer }, [done.buffer])
}

self.addEventListener("message", (event: MessageEvent<TileWorkRequest>) => {
  answer(event.data).catch((error) =>
    reply({ id: event.data.id, error: String(error) })
  )
})

// Told once the module has loaded: until then the work is done where it was
// asked for, so a worker that cannot load costs frames and not pixels.
reply({ ready: true })
