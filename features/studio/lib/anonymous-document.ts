"use client"

/**
 * The document an artist paints in before there is an account (§9a).
 *
 * Anonymous work is a real document: it has an id, it is stored locally under
 * that id, and signing in later migrates it rather than replacing it. The id
 * lives in `localStorage` because it has to outlive the tab that made it,
 * while the pixels it names live in OPFS.
 */

const KEY = "velura:anonymous-document"

export function anonymousDocumentId(): string {
  try {
    const existing = window.localStorage.getItem(KEY)
    if (existing) return existing
    const created = `local-${crypto.randomUUID()}`
    window.localStorage.setItem(KEY, created)
    return created
  } catch {
    // Storage denied: the session still paints, it just cannot be reopened.
    return `local-${crypto.randomUUID()}`
  }
}
