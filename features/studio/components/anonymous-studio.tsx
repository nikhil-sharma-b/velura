"use client"

import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"

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
export function AnonymousStudio() {
  const router = useRouter()
  // Someone signed in lands in their library, not on a signed-out canvas
  // asking them to sign in. Checked after hydration, as the server cannot
  // see the session; the studio is still starting up when it leaves.
  useEffect(() => {
    if (hasSavedSession()) router.replace("/library")
  }, [router])
  const [documentId] = useState<string | undefined>(() =>
    typeof window === "undefined" ? undefined : anonymousDocumentId()
  )
  useEffect(() => {
    // With OPFS, navigation cannot discard the drawing: it is already on
    // disk. In a denied/unsupported storage environment the fallback is
    // memory, so leaving really would lose it and needs the browser's prompt.
    if (opfsAvailable()) return
    const guard = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener("beforeunload", guard)
    return () => window.removeEventListener("beforeunload", guard)
  }, [])
  return <CanvasHost documentId={documentId} />
}
