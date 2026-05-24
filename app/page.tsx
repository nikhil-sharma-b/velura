import { APP_NAME } from "@/lib/constants"
import { Metadata } from "next"

export const metadata: Metadata = {
  title: `Home | ${APP_NAME}`,
  description: "Find all your drawings",
}

export default function Page() {
  return (
    <main className="p-4">
      <h1 className="text-4xl font-bold">Welcome to Velura</h1>
    </main>
  )
}
