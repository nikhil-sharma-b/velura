/**
 * The id a tab files its presence heartbeats under (18). It outlives a reload
 * of the tab: a reloaded page minting a new one would find its own previous
 * heartbeat still inside the active window and warn that the document is
 * open somewhere else.
 *
 * `sessionStorage` is per tab and survives a reload, but a duplicated tab
 * starts with a copy of it. The live marker tells the two apart: it is
 * cleared on `pagehide`, which a reload fires and a duplicate's original does
 * not, so an id found still marked live belongs to another open tab.
 */
const ID_KEY = "velura.tabSession.id"
const LIVE_KEY = "velura.tabSession.live"

export function claimTabSessionId(
  storage: Storage,
  mint: () => string = () => crypto.randomUUID()
): string {
  try {
    const existing = storage.getItem(ID_KEY)
    const id =
      existing && storage.getItem(LIVE_KEY) === null ? existing : mint()
    storage.setItem(ID_KEY, id)
    storage.setItem(LIVE_KEY, "1")
    return id
  } catch {
    // Storage refused (a locked-down browser): a fresh id per load is the
    // old behaviour, whose only cost is a brief false warning after reload.
    return mint()
  }
}

/** Called on `pagehide`, so the reload that follows may reclaim the id. */
export function releaseTabSessionId(storage: Storage): void {
  try {
    storage.removeItem(LIVE_KEY)
  } catch {
    // Nothing to release where nothing could be stored.
  }
}

/** Called on `pageshow` from the back/forward cache: the tab is live again. */
export function reclaimTabSessionId(storage: Storage): void {
  try {
    storage.setItem(LIVE_KEY, "1")
  } catch {
    // As above.
  }
}

let claimed: string | undefined

/**
 * This tab's id, claimed once per page load however many times it is asked
 * for — a Strict Mode double render or a second document opened in-app must
 * not mistake this page's own claim for another tab's.
 */
export function tabSessionId(): string {
  if (typeof window === "undefined") return crypto.randomUUID()
  if (claimed) return claimed
  let storage: Storage
  try {
    storage = window.sessionStorage
  } catch {
    // Reading the property itself throws where site storage is blocked.
    return (claimed = crypto.randomUUID())
  }
  claimed = claimTabSessionId(storage)
  window.addEventListener("pagehide", () => releaseTabSessionId(storage))
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) reclaimTabSessionId(storage)
  })
  return claimed
}
