import { DocumentLibrary } from "@/features/library/components/document-library"
import { APP_NAME } from "@/lib/constants"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: `Documents | ${APP_NAME}`,
  description: "The documents you have saved",
}

export default function Page() {
  return <DocumentLibrary />
}
