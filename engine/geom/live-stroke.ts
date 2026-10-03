/**
 * The mesh of a pressure stroke while it is drawn, made piece by piece. The
 * fit freezes the curves behind the pen (`createPressureFit`), and a frozen
 * curve's triangles are kept until its widths change, so a frame meshes the
 * few curves near the pen rather than the whole stroke again: the work per
 * frame stays the same however long the stroke grows.
 */

import { flattenPath, type PressurePiece } from "../doc/vector-path"
import type { VectorStroke } from "../doc/vector-scene"
import { mergeMeshes, tessellateStroke, type Mesh } from "./tessellate"

export function createLiveStrokeMesh() {
  /** Per detail, each frozen piece's mesh and the widths it was made at. */
  const kept = new Map<number, Map<number, { key: string; mesh: Mesh }>>()

  const build = (
    piece: PressurePiece,
    stroke: Pick<VectorStroke, "width" | "cap" | "join">,
    detail: number,
    ends: { start: boolean; end: boolean },
    around: { before?: number; after?: number }
  ) => {
    const flat = flattenPath(
      { kind: "path", nodes: piece.nodes, closed: false },
      detail,
      around
    )
    return tessellateStroke(
      flat.points,
      false,
      stroke,
      flat.widths,
      flat.corners,
      detail,
      ends
    )
  }

  return {
    /** The stroke's outline at `detail`, from the pieces its fit last made. */
    mesh(
      pieces: readonly PressurePiece[],
      stroke: Pick<VectorStroke, "width" | "cap" | "join">,
      detail: number
    ): Mesh {
      let level = kept.get(detail)
      if (!level) kept.set(detail, (level = new Map()))
      const parts = pieces.map((piece, i) => {
        const ends = { start: i === 0, end: i === pieces.length - 1 }
        // The widths either side, so this piece's ease runs on into theirs.
        const around = {
          before: pieces[i - 1]?.nodes.at(-2)?.width,
          after: pieces[i + 1]?.nodes[1]?.width,
        }
        if (!piece.frozen) return build(piece, stroke, detail, ends, around)
        const key = `${piece.key}|${around.before}|${around.after}|${ends.start}|${stroke.width}|${stroke.cap}|${stroke.join}`
        const found = level.get(i)
        if (found?.key === key) return found.mesh
        const mesh = build(piece, stroke, detail, ends, around)
        level.set(i, { key, mesh })
        return mesh
      })
      return mergeMeshes(parts, "union")
    },
  }
}
