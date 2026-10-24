/**
 * The paper a document's fluid brushes paint on (fluid brushes 15): one of a
 * few built-in papers, chosen per document and saved with it. Every fluid
 * brush in a document shares it; no other brush reads it.
 */

/** The papers a document can choose, from the smoothest to the roughest. */
export const PAPERS = ["hot-press", "cold-press", "rough"] as const

export type Paper = (typeof PAPERS)[number]

/** The paper every document had before it could choose one. */
export const DEFAULT_PAPER: Paper = "cold-press"

/**
 * A paper as it may be stored, from whatever arrived: a save from an older
 * client, which wrote none, or a newer one, which may name a paper this one
 * does not have. Either opens on the default.
 */
export function normalisePaper(raw: unknown): Paper {
  return PAPERS.includes(raw as Paper) ? (raw as Paper) : DEFAULT_PAPER
}
