/**
 * Vector layers' scenes (20) as Convex stores them: outside the document's
 * `structure`, in content-addressed `sceneChunks` rows the tree names by hash.
 *
 * A scene is the whole of what a vector layer holds, and one polygon may carry
 * a hundred thousand points, so inside the tree it would put the document row
 * and every restore point past Convex's one-megabyte document limit. Split
 * out, a restore point costs a list of hashes, and a flush that changed one
 * shape writes the one chunk that shape is in: chunks break between objects
 * wherever they can, so an unchanged run of objects hashes the same way it
 * did last time.
 */

import { ConvexError } from "convex/values"

import { parseScene } from "../../engine/doc/vector-scene"

/**
 * The most characters one chunk row holds. A character is at most four bytes
 * of UTF-8, so this stays under the document limit whatever an id contains.
 */
export const SCENE_CHUNK_CHARS = 200_000

type Node = {
  kind?: unknown
  scene?: unknown
  sceneChunks?: string[]
  children?: Node[]
}
type Tree = { layers?: Node[] }

function mapNodes(nodes: readonly Node[], visit: (node: Node) => Node): Node[] {
  return nodes.map((node) => {
    const visited = visit(node)
    return visited.children
      ? { ...visited, children: mapNodes(visited.children, visit) }
      : visited
  })
}

function hasLayers(structure: unknown): structure is Tree {
  return (
    typeof structure === "object" &&
    structure !== null &&
    Array.isArray((structure as Tree).layers)
  )
}

async function hashOf(data: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(data)
  )
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

/**
 * The scene's objects as JSON, cut into pieces that concatenate back to it.
 * Each object is written with a trailing comma and a piece ends between two
 * of them unless one object is too big for a piece by itself.
 */
function pieces(objects: readonly unknown[]): string[] {
  const out: string[] = []
  let current = ""
  for (const object of objects) {
    let text = `${JSON.stringify(object)},`
    if (current.length + text.length <= SCENE_CHUNK_CHARS) {
      current += text
      continue
    }
    if (current) out.push(current)
    current = ""
    while (text.length > SCENE_CHUNK_CHARS) {
      // Never between the halves of a surrogate pair: a lone half does not
      // survive being encoded to be hashed and stored.
      const low = text.charCodeAt(SCENE_CHUNK_CHARS)
      const cut =
        low >= 0xdc00 && low <= 0xdfff
          ? SCENE_CHUNK_CHARS - 1
          : SCENE_CHUNK_CHARS
      out.push(text.slice(0, cut))
      text = text.slice(cut)
    }
    current = text
  }
  if (current) out.push(current)
  return out
}

/**
 * The tree as it is stored, with each vector layer's scene replaced by the
 * hashes of its chunks, and the chunks by hash. Scenes are checked on the way
 * in: a scene a session cannot read back must not become the saved state.
 */
export async function splitScenes(
  structure: unknown
): Promise<{ structure: unknown; chunks: Map<string, string> }> {
  const chunks = new Map<string, string>()
  if (!hasLayers(structure)) return { structure, chunks }
  const split = new Map<Node, string[]>()
  const walk = async (nodes: readonly Node[]) => {
    for (const node of nodes) {
      if (node.children) await walk(node.children)
      if (node.kind !== "vector" || node.scene === undefined) continue
      let scene
      try {
        scene = parseScene(node.scene)
      } catch (error) {
        throw new ConvexError(
          `A vector layer's shapes could not be read: ${(error as Error).message}`
        )
      }
      const hashes: string[] = []
      for (const data of pieces(scene.objects)) {
        const hash = await hashOf(data)
        chunks.set(hash, data)
        hashes.push(hash)
      }
      split.set(node, hashes)
    }
  }
  await walk(structure.layers!)
  return {
    structure: {
      ...structure,
      layers: mapNodes(structure.layers!, (node) => {
        const hashes = split.get(node)
        if (!hashes) return node
        const { scene: _scene, ...rest } = node
        return { ...rest, sceneChunks: hashes }
      }),
    },
    chunks,
  }
}

/** Every chunk a stored tree names. */
export function sceneChunkHashes(structure: unknown): Set<string> {
  const hashes = new Set<string>()
  if (!hasLayers(structure)) return hashes
  const walk = (nodes: readonly Node[]) => {
    for (const node of nodes) {
      for (const hash of node.sceneChunks ?? []) hashes.add(hash)
      if (node.children) walk(node.children)
    }
  }
  walk(structure.layers!)
  return hashes
}

/**
 * A stored tree with its scenes put back, as a session reads it. A tree
 * written before scenes had rows of their own carries them inline and comes
 * back as it is.
 */
export async function joinScenes(
  structure: unknown,
  read: (hashes: readonly string[]) => Promise<Map<string, string>>
): Promise<unknown> {
  if (!hasLayers(structure)) return structure
  const hashes = [...sceneChunkHashes(structure)]
  const data = hashes.length > 0 ? await read(hashes) : new Map()
  return {
    ...structure,
    layers: mapNodes(structure.layers!, (node) => {
      if (!node.sceneChunks) return node
      const { sceneChunks, ...rest } = node
      const text = sceneChunks
        .map((hash) => {
          const piece = data.get(hash)
          if (piece === undefined)
            throw new ConvexError("Part of a vector layer's shapes is missing.")
          return piece
        })
        .join("")
      return {
        ...rest,
        scene: { objects: JSON.parse(`[${text.slice(0, -1)}]`) },
      }
    }),
  }
}
