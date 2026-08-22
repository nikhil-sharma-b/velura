import { Caveat, Geist_Mono, Instrument_Serif, Karla } from "next/font/google"

import { Topbar } from "@/components/layout/topbar"
import { ThemeProvider } from "@/components/theme-provider"
import { APP_NAME } from "@/lib/constants"
import { cn } from "@/lib/utils"
import { Metadata } from "next"
import "./globals.css"

const fontSans = Karla({ subsets: ["latin"], variable: "--font-sans" })

// Display face: wordmark, headings, empty states. Single weight by design —
// the Didone contrast carries the emphasis, so there is no bold to load.
const fontHeading = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-heading",
})

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
        fontHeading.variable,
        fontAnnotate.variable,
        fontMono.variable
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
