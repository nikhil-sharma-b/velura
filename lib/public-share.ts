import { ConvexHttpClient } from "convex/browser"
import { cache } from "react"

import { api } from "@/convex/_generated/api"

export type PublicShare = {
  previewVersion: number
}

function client(): ConvexHttpClient | null {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL
  return url ? new ConvexHttpClient(url) : null
}

export const getPublicShare = cache(async function getPublicShare(
  token: string
): Promise<PublicShare | null> {
  const convex = client()
  if (convex === null) return null
  return await convex.query(api.shareLinks.publicView, { token })
})

export async function getSharedPreviewUrl(
  token: string
): Promise<string | null> {
  const convex = client()
  if (convex === null) return null
  return await convex.action(api.tilesActions.presignSharedPreviewDownload, {
    token,
  })
}
