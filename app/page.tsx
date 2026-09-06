import { AnonymousStudio } from "@/features/studio/components/anonymous-studio"
import { APP_NAME } from "@/lib/constants"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: `Studio | ${APP_NAME}`,
  description: "Your digital painting canvas",
}

export default function Page() {
  return <AnonymousStudio />
}
