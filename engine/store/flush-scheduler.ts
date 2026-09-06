/**
 * When a flush runs, decoupled from what a flush does (§9.2's "30s idle /
 * tab-hide / beforeunload / explicit save"). Kept pure and timer-injectable
 * so the coalescing behaviour — many strokes, one flush — is testable
 * without a browser or a real clock.
 */

export interface FlushScheduler {
  /** Call on every stroke commit. Pushes the idle deadline out. */
  touch(): void
  /** Runs the flush now, cancelling any pending idle timer. */
  flushNow(): void
  dispose(): void
}

export function createFlushScheduler(options: {
  flush: () => void
  idleMs: number
  setTimeout?: (fn: () => void, ms: number) => unknown
  clearTimeout?: (id: unknown) => void
}): FlushScheduler {
  const schedule =
    options.setTimeout ?? ((fn, ms) => globalThis.setTimeout(fn, ms))
  const cancel =
    options.clearTimeout ?? ((id) => globalThis.clearTimeout(id as number))
  let timer: unknown | undefined

  function clear() {
    if (timer !== undefined) {
      cancel(timer)
      timer = undefined
    }
  }

  return {
    touch() {
      clear()
      timer = schedule(() => {
        timer = undefined
        options.flush()
      }, options.idleMs)
    },
    flushNow() {
      clear()
      options.flush()
    },
    dispose: clear,
  }
}
