import { SignInPanel } from "@/features/library/components/sign-in-panel"
import { APP_NAME } from "@/lib/constants"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: `Sign in | ${APP_NAME}`,
  description: "Sign in with a one-time code",
}

export default function Page() {
  return <SignInPanel />
}
