/**
 * When the stroke's textures are kept warm (live brushes 24).
 *
 * A large texture a second or two unused is slow the next time it is drawn
 * into: 20 ms for a layer of 8192², on the machine the benchmark is run on,
 * and that is the frame a stroke opens in. Drawing nothing into it every so
 * often keeps it as it is mid-stroke. That is only worth a GPU that never
 * rests while the artist is at the canvas, so the warming starts when they
 * arrive, ahead of the pen, and stops a while after they were last there.
 *
 * What a warming does is the renderer's; this is when one runs, kept pure
 * and timer-injectable so it is testable without a browser or a real clock.
 */

export interface WarmKeeper {
  /** The artist is at the canvas: the pen moved over it, or a frame drew. */
  touch(): void
  dispose(): void
}

export function createWarmKeeper(options: {
  warm: () => void
  /** Between warmings: under what it takes a texture to go cold. */
  intervalMs: number
  /** How long after the artist was last there the warming goes on. */
  lifetimeMs: number
  now?: () => number
  setTimeout?: (fn: () => void, ms: number) => unknown
  clearTimeout?: (id: unknown) => void
}): WarmKeeper {
  const now = options.now ?? (() => performance.now())
  const schedule =
    options.setTimeout ?? ((fn, ms) => globalThis.setTimeout(fn, ms))
  const cancel =
    options.clearTimeout ?? ((id) => globalThis.clearTimeout(id as number))
  let timer: unknown | undefined
  let touched = 0
  let disposed = false

  function tick() {
    timer = undefined
    if (now() - touched >= options.lifetimeMs) return
    options.warm()
    timer = schedule(tick, options.intervalMs)
  }

  return {
    // Called on every pointer move and every frame, so it sets no timer and
    // allocates nothing while one is running.
    touch() {
      if (disposed) return
      touched = now()
      if (timer === undefined) tick()
    },
    dispose() {
      disposed = true
      if (timer !== undefined) cancel(timer)
      timer = undefined
    },
  }
}
