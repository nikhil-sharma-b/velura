/**
 * When a layer's thumbnail is redrawn, decoupled from how.
 *
 * A thumbnail is a convenience, and painting is the product: none may be
 * drawn on a frame of drawing (D30). So changes only mark thumbnails stale,
 * and the stale ones are drawn together once the document has been quiet for
 * a moment and no stroke is in flight. Twenty strokes on one layer cost one
 * small draw, after the last of them, and a document of fifty layers redraws
 * only the ones a change actually reached.
 */

import type { LayerNode } from "../doc/document"

export interface ThumbnailScheduler {
  /** Marks thumbnails stale and pushes the quiet deadline out. */
  invalidate(ids: Iterable<string>): void
  dispose(): void
}

export function createThumbnailScheduler(options: {
  /** How long the document must go unchanged before anything is drawn. */
  quietMs: number
  /** True while a stroke is in flight; drawing waits until it is not. */
  busy(): boolean
  draw(ids: ReadonlySet<string>): void
  setTimeout?: (fn: () => void, ms: number) => unknown
  clearTimeout?: (id: unknown) => void
}): ThumbnailScheduler {
  const schedule =
    options.setTimeout ?? ((fn, ms) => globalThis.setTimeout(fn, ms))
  const cancel =
    options.clearTimeout ?? ((id) => globalThis.clearTimeout(id as number))
  let stale = new Set<string>()
  let timer: unknown | undefined

  function arm() {
    if (timer !== undefined) cancel(timer)
    timer = schedule(fire, options.quietMs)
  }

  function fire() {
    timer = undefined
    if (stale.size === 0) return
    // A stroke began inside the quiet window: try again once it can have
    // ended, rather than drawing between two of its frames.
    if (options.busy()) {
      arm()
      return
    }
    const ids = stale
    stale = new Set()
    options.draw(ids)
  }

  return {
    invalidate(ids) {
      for (const id of ids) stale.add(id)
      arm()
    },
    dispose() {
      if (timer !== undefined) cancel(timer)
      timer = undefined
      stale.clear()
    },
  }
}

/**
 * Every thumbnail a change to one surface's pixels shows up in: the surface's
 * own, then each group around it, innermost first. A mask's pixels change its
 * layer's groups too, because a group's thumbnail shows its children masked.
 */
export function thumbnailOwners(
  nodes: readonly LayerNode[],
  surfaceId: string
): string[] {
  const groups = (items: readonly LayerNode[]): string[] | undefined => {
    for (const node of items) {
      if (node.id === surfaceId || node.mask?.id === surfaceId) return []
      if (node.kind === "group") {
        const inner = groups(node.children)
        if (inner) return [...inner, node.id]
      }
    }
  }
  return [surfaceId, ...(groups(nodes) ?? [])]
}
