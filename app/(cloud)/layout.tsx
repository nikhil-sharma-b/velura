import { CloudProvider } from "@/features/library/components/cloud-provider"

export default function CloudLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <CloudProvider>{children}</CloudProvider>
}
