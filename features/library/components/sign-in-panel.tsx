"use client"

import { Authenticated, AuthLoading, Unauthenticated } from "convex/react"
import { useRouter } from "next/navigation"
import { useEffect } from "react"

import { Spinner } from "@/components/ui/spinner"
import { SignInForm } from "@/features/library/components/sign-in-form"
import { APP_NAME } from "@/lib/constants"

export function SignInPanel() {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-sm flex-col justify-center gap-6 p-6">
      <AuthLoading>
        <Spinner className="mx-auto" />
      </AuthLoading>
      <Unauthenticated>
        <div className="flex flex-col gap-2">
          <h1 className="font-heading text-4xl">Sign in to {APP_NAME}</h1>
          <p className="text-sm text-muted-foreground">
            A code arrives by email. Nothing to remember, nothing to leak.
          </p>
        </div>
        <SignInForm />
      </Unauthenticated>
      <Authenticated>
        <RedirectToLibrary />
      </Authenticated>
    </main>
  )
}

// A session that survived the last visit lands the artist in the library rather
// than on a sign-in form they no longer need.
function RedirectToLibrary() {
  const router = useRouter()
  useEffect(() => {
    router.replace("/library")
  }, [router])
  return <Spinner className="mx-auto" />
}
