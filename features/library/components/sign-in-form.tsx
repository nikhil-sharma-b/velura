"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useAuthActions } from "@convex-dev/auth/react"
import { ArrowLeftIcon, EnvelopeSimpleIcon } from "@phosphor-icons/react"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { APP_NAME } from "@/lib/constants"
import {
  type CodeFormValues,
  codeFormSchema,
  type EmailFormValues,
  emailFormSchema,
} from "@/features/library/lib/schemas"

const PROVIDER = "email-code"

/**
 * Two steps, one provider: the address receives a code, the code becomes a
 * session. There is no password field anywhere in this flow by design (D8).
 */
export function SignInForm() {
  const { signIn } = useAuthActions()
  const router = useRouter()
  const [email, setEmail] = useState<string | null>(null)

  const emailForm = useForm<EmailFormValues>({
    defaultValues: { email: "" },
    resolver: zodResolver(emailFormSchema),
  })
  const codeForm = useForm<CodeFormValues>({
    defaultValues: { code: "" },
    resolver: zodResolver(codeFormSchema),
  })

  const requestCode = async ({ email: address }: EmailFormValues) => {
    try {
      await signIn(PROVIDER, { email: address })
      setEmail(address)
      codeForm.reset({ code: "" })
      toast.success(`Code sent to ${address}`)
    } catch {
      toast.error("Could not send that code. Check the address and try again.")
    }
  }

  const submitCode = async ({ code }: CodeFormValues) => {
    if (email === null) return
    try {
      await signIn(PROVIDER, { email, code })
      router.replace("/library")
    } catch {
      codeForm.setError("code", {
        message: "That code is wrong or has expired. Ask for a new one.",
      })
    }
  }

  if (email === null) {
    return (
      <form
        className="flex flex-col gap-4"
        onSubmit={emailForm.handleSubmit(requestCode)}
        noValidate
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            autoFocus
            placeholder="you@example.com"
            aria-invalid={emailForm.formState.errors.email !== undefined}
            {...emailForm.register("email")}
          />
          {emailForm.formState.errors.email ? (
            <p role="alert" className="text-sm text-destructive">
              {emailForm.formState.errors.email.message}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              {APP_NAME} emails a one-time code. There is no password to
              remember.
            </p>
          )}
        </div>
        <Button type="submit" disabled={emailForm.formState.isSubmitting}>
          {emailForm.formState.isSubmitting ? (
            <Spinner />
          ) : (
            <EnvelopeSimpleIcon />
          )}
          Send me a code
        </Button>
      </form>
    )
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={codeForm.handleSubmit(submitCode)}
      noValidate
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="code">Code</Label>
        <Input
          id="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          placeholder="12345678"
          aria-invalid={codeForm.formState.errors.code !== undefined}
          {...codeForm.register("code")}
        />
        {codeForm.formState.errors.code ? (
          <p role="alert" className="text-sm text-destructive">
            {codeForm.formState.errors.code.message}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Sent to {email}. It expires in fifteen minutes.
          </p>
        )}
      </div>
      <Button type="submit" disabled={codeForm.formState.isSubmitting}>
        {codeForm.formState.isSubmitting ? <Spinner /> : null}
        Sign in
      </Button>
      <Button type="button" variant="ghost" onClick={() => setEmail(null)}>
        <ArrowLeftIcon />
        Use a different address
      </Button>
    </form>
  )
}
