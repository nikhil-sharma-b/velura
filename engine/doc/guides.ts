/**
 * Guides (16): lines the artist drags out of the rulers and leaves on the
 * canvas, saved with the document and snapped to like its edges are.
 *
 * A guide is a whole line in document pixels along one axis — `x` a vertical
 * line at that x, `y` a horizontal one — matching `SnapTargets`, so snapping
 * to a guide is one more number on the axis it already reads. They are part
 * of the document's structure rather than of the session: laying one down is
 * a step that undoes, and it travels with every save and every device.
 */

import type { SnapTargets } from "./snap"

export type GuideAxis = "x" | "y"

export type Guide = Readonly<{
  id: string
  axis: GuideAxis
  position: number
}>

/**
 * More than any layout needs, few enough that a document from elsewhere
 * cannot make every drag search a haystack.
 */
export const MAX_GUIDES = 200

function requireFinite(position: number) {
  if (!Number.isFinite(position))
    throw new Error("A guide must sit at a finite position.")
}

/** Past every id in use, so a removed guide's id is never handed out again. */
function nextId(guides: readonly Guide[]): string {
  let highest = 0
  for (const guide of guides) {
    const sequence = /-(\d+)$/.exec(guide.id)
    if (sequence) highest = Math.max(highest, Number(sequence[1]))
  }
  return `guide-${highest + 1}`
}

export function addGuide(
  guides: readonly Guide[],
  axis: GuideAxis,
  position: number
): { guides: Guide[]; id: string } {
  requireFinite(position)
  if (guides.length >= MAX_GUIDES)
    throw new Error(`A document holds at most ${MAX_GUIDES} guides.`)
  const id = nextId(guides)
  return { guides: [...guides, { id, axis, position }], id }
}

export function moveGuide(
  guides: readonly Guide[],
  id: string,
  position: number
): Guide[] {
  requireFinite(position)
  return guides.map((guide) =>
    guide.id === id ? { ...guide, position } : guide
  )
}

export function removeGuide(guides: readonly Guide[], id: string): Guide[] {
  return guides.filter((guide) => guide.id !== id)
}

/**
 * Guides as they may be stored, from whatever arrived: a save from another
 * machine, an older client, a hand-edited file. Rebuilt field by field, so
 * anything the model has no place for is dropped rather than kept; a repeated
 * id keeps its first guide.
 */
export function normaliseGuides(raw: unknown): Guide[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const guides: Guide[] = []
  for (const item of raw) {
    if (guides.length >= MAX_GUIDES) break
    if (typeof item !== "object" || item === null) continue
    const { id, axis, position } = item as Record<string, unknown>
    if (typeof id !== "string" || seen.has(id)) continue
    if (axis !== "x" && axis !== "y") continue
    if (typeof position !== "number" || !Number.isFinite(position)) continue
    seen.add(id)
    guides.push({ id, axis, position })
  }
  return guides
}

/** `targets` with every guide's line added on its own axis. */
export function guideSnapTargets(
  targets: SnapTargets,
  guides: readonly Guide[]
): SnapTargets {
  return {
    x: [
      ...targets.x,
      ...guides.filter((g) => g.axis === "x").map((g) => g.position),
    ],
    y: [
      ...targets.y,
      ...guides.filter((g) => g.axis === "y").map((g) => g.position),
    ],
  }
}
