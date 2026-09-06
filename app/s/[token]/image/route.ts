import { getSharedPreviewUrl } from "@/lib/public-share"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const previewUrl = await getSharedPreviewUrl(token)
  if (previewUrl === null) return new Response("Not found", { status: 404 })

  const preview = await fetch(previewUrl, { cache: "no-store" })
  if (!preview.ok || preview.body === null) {
    return new Response("Not found", { status: 404 })
  }
  return new Response(preview.body, {
    headers: {
      "Content-Type": preview.headers.get("Content-Type") ?? "image/png",
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  })
}
