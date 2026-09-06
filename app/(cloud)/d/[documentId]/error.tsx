"use client"

import { DocumentNotFound } from "@/features/library/components/document-workspace"

// The document query throws for a row that is missing or owned by someone else
// — deliberately the same error, so a stranger learns nothing from the wording.
export default function DocumentError() {
  return <DocumentNotFound />
}
