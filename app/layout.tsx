import { Geist_Mono, Inter } from "next/font/google"

import { Topbar } from "@/components/layout/topbar/topbar"
import { ThemeProvider } from "@/components/theme-provider"
import { APP_NAME } from "@/lib/constants"
import { cn } from "@/lib/utils"
import { Metadata } from "next"
import "./globals.css"

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" })

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

export const metadata: Metadata = {
  title: APP_NAME,
  description:
    "Velura is a web first drawing app that allows you to create stunning digital sktches.",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(
        "antialiased",
        fontMono.variable,
        "font-sans",
        inter.variable
      )}
    >
      <body>
        <ThemeProvider>
          <Topbar />
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
