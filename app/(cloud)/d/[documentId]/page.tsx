import { DocumentWorkspace } from "@/features/library/components/document-workspace"
import { APP_NAME } from "@/lib/constants"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: `Studio | ${APP_NAME}`,
  description: "Your digital painting canvas",
}

export default async function Page({
  params,
}: {
  params: Promise<{ documentId: string }>
}) {
  const { documentId } = await params
  return <DocumentWorkspace documentId={documentId} />
}
