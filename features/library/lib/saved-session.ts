/**
 * Whether this browser holds a signed-in session, read without a backend.
 *
 * The studio at `/` mounts no Convex client, so it cannot ask. Convex Auth
 * keeps its refresh token in localStorage under a key namespaced by the
 * deployment URL with everything but letters and digits stripped; its
 * presence is what "signed in on this device" means until the library
 * checks it. A stale token is caught there, which sends the artist on to
 * sign in.
 */
export function hasSavedSession(): boolean {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL
  if (!url) return false
  try {
    return window.localStorage.getItem(refreshTokenKey(url)) !== null
  } catch {
    // Storage blocked: no session could have been kept either.
    return false
  }
}

/** Where Convex Auth keeps a deployment's refresh token in localStorage. */
export function refreshTokenKey(convexUrl: string): string {
  return `__convexAuthRefreshToken_${convexUrl.replace(/[^a-zA-Z0-9]/g, "")}`
}
