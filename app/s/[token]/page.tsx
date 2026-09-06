import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { APP_NAME } from "@/lib/constants"
import { getPublicShare } from "@/lib/public-share"

type SharePageProps = { params: Promise<{ token: string }> }

export async function generateMetadata({
  params,
}: SharePageProps): Promise<Metadata> {
  const { token } = await params
  const share = await getPublicShare(token)
  if (share === null) return { title: `Unavailable | ${APP_NAME}` }

  const image = `/s/${encodeURIComponent(token)}/image?v=${share.previewVersion ?? 0}`
  return {
    title: `Shared work | ${APP_NAME}`,
    description: `A work in progress shared from ${APP_NAME}.`,
    robots: { index: false, follow: false },
    openGraph: {
      title: `Shared work from ${APP_NAME}`,
      description: `A work in progress shared from ${APP_NAME}.`,
      images: [image],
      type: "website",
    },
    twitter: { card: "summary_large_image", images: [image] },
  }
}

export default async function SharePage({ params }: SharePageProps) {
  const { token } = await params
  const share = await getPublicShare(token)
  if (share === null) notFound()

  return (
    <main className="flex min-h-svh flex-col bg-neutral-950 text-neutral-100">
      <header className="border-b border-white/10 px-5 py-4">
        <h1 className="font-heading text-2xl">Shared from {APP_NAME}</h1>
      </header>
      <div className="flex flex-1 items-center justify-center p-4 sm:p-8">
        {share.previewVersion === null ? (
          <div className="flex aspect-[4/3] w-full max-w-4xl items-center justify-center rounded-lg bg-neutral-900 text-neutral-400">
            Preview available after the next sync
          </div>
        ) : (
          // This endpoint proxies only the flattened PNG. It deliberately does
          // not mount the studio, Convex auth, WebGPU, or document loaders.
          // oxlint-disable-next-line next/no-img-element
          <img
            src={`/s/${encodeURIComponent(token)}/image?v=${share.previewVersion}`}
            alt="Shared artwork"
            className="max-h-[calc(100svh-7rem)] max-w-full rounded-lg object-contain shadow-2xl"
          />
        )}
      </div>
    </main>
  )
}
