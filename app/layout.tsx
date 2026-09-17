import { Caveat, Geist_Mono, Karla } from "next/font/google"

import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/sonner"
import { APP_NAME } from "@/lib/constants"
import { cn } from "@/lib/utils"
import { Metadata } from "next"
import "./globals.css"

// One text family for the whole product. Karla is a variable face, so the
// display role is the same skeleton at a heavier weight and tighter tracking
// rather than a second typeface competing with the chrome.
const fontSans = Karla({ subsets: ["latin"], variable: "--font-sans" })

// Margin notes only. Never used for anything the reader must not miss.
const fontAnnotate = Caveat({ subsets: ["latin"], variable: "--font-annotate" })

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
        "font-sans",
        fontSans.variable,
        fontAnnotate.variable,
        fontMono.variable
      )}
    >
      <body>
        <ThemeProvider>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  )
}
