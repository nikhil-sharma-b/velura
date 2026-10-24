"use client"

import { useRouter } from "next/navigation"
import { useEffect, useState, useSyncExternalStore } from "react"

import { hasSavedSession } from "@/features/library/lib/saved-session"

import { opfsAvailable } from "@/engine/store/blob-store"
import { CanvasHost } from "./canvas-host"
import { anonymousDocumentId } from "../lib/anonymous-document"

/**
 * The studio with no account behind it. The id is settled in the browser —
 * the server has no idea which anonymous document this visitor holds — and
 * work made signed out is stored locally like any other document, so it is
 * still there on the next visit (§9a).
 */
/** The session is read once per visit; signing in happens on another page. */
const noChanges = () => () => {}

export function AnonymousStudio() {
  const router = useRouter()
  // Someone signed in lands in their library, not on a signed-out canvas
  // asking them to sign in. The server cannot see the session, so it is
  // unknown (null) until hydration, and the studio waits on it: started
  // first, it would boot an engine and claim an anonymous document only to
  // be left.
  const signedIn = useSyncExternalStore(noChanges, hasSavedSession, () => null)
  useEffect(() => {
    if (signedIn) router.replace("/library")
  }, [signedIn, router])
  const [documentId, setDocumentId] = useState<string>()
  if (signedIn === false && documentId === undefined)
    setDocumentId(anonymousDocumentId())
  useEffect(() => {
    // With OPFS, navigation cannot discard the drawing: it is already on
    // disk. In a denied/unsupported storage environment the fallback is
    // memory, so leaving really would lose it and needs the browser's prompt.
    if (opfsAvailable()) return
    const guard = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener("beforeunload", guard)
    return () => window.removeEventListener("beforeunload", guard)
  }, [])
  if (documentId === undefined) return null
  return <CanvasHost documentId={documentId} />
}
