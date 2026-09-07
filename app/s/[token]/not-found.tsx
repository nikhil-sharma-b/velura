import Link from "next/link"

import { Button } from "@/components/ui/button"

export default function ShareNotFound() {
  return (
    <main className="mx-auto flex min-h-svh max-w-sm flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="font-heading-display font-heading text-3xl">
        This shared work is unavailable
      </h1>
      <p className="text-muted-foreground">
        The link may have been revoked by its artist.
      </p>
      <Button asChild>
        <Link href="/">Open Velura</Link>
      </Button>
    </main>
  )
}
