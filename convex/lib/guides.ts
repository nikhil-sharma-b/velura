/**
 * Guides (16) ride inside a document's opaque `structure`, which is otherwise
 * stored as the client wrote it. Guides are the one part a server-side reader
 * can check without knowing the layer tree, and they arrive from any client
 * version and any `.velura` file, so they are rebuilt here on the way in —
 * the same rule the engine applies when it restores a tree.
 */

import { normaliseGuides } from "../../engine/doc/guides"

export function withNormalisedGuides(structure: unknown): unknown {
  if (typeof structure !== "object" || structure === null) return structure
  if (!("guides" in structure)) return structure
  return {
    ...structure,
    guides: normaliseGuides((structure as { guides: unknown }).guides),
  }
}
