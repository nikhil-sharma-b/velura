import { APP_NAME } from "@/lib/constants"
import { Metadata } from "next"

export const metadata: Metadata = {
  title: `Home | ${APP_NAME}`,
  description: "Find all your drawings",
}

export default function Page() {
  return (
    <main className="workspace-surface min-h-[calc(100svh-4rem)] p-6">
      <section className="w-full max-w-lg border bg-card/90 p-6 shadow-[0_18px_50px_rgb(0_0_0/0.12)] backdrop-blur-sm">
        <h1 className="font-heading text-5xl font-normal tracking-tight">
          Welcome to Velura
        </h1>
        <div className="brand-stroke mt-3 h-1 w-20 rounded-full" />
        <p className="mt-4 max-w-sm text-sm leading-relaxed text-muted-foreground">
          Your drawings and creative workspace will live here.
        </p>
      </section>
    </main>
  )
}
