import type { LayerSummary } from "@/engine"

export function findSummary(
  nodes: readonly LayerSummary[],
  id: string
): LayerSummary | undefined {
  for (const node of nodes) {
    if (node.id === id) return node
    if (node.kind === "group") {
      const found = findSummary(node.children, id)
      if (found) return found
    }
  }
}

export function leafCount(nodes: readonly LayerSummary[]): number {
  return nodes.reduce(
    (count, node) =>
      count + (node.kind === "group" ? leafCount(node.children) : 1),
    0
  )
}
