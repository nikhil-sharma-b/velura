"use client"

import { useState } from "react"

import { CanvasHost } from "./canvas-host"
import { anonymousDocumentId } from "../lib/anonymous-document"

/**
 * The studio with no account behind it. The id is settled in the browser —
 * the server has no idea which anonymous document this visitor holds — and
 * work made signed out is stored locally like any other document, so it is
 * still there on the next visit (§9a).
 */
export function AnonymousStudio() {
  const [documentId] = useState<string | undefined>(() =>
    typeof window === "undefined" ? undefined : anonymousDocumentId()
  )
  return <CanvasHost documentId={documentId} />
}
