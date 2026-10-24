"use client"

import * as React from "react"
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes"

import { useKeybinds } from "@/features/commands/hooks/use-keybinds"
import { createRegistry } from "@/features/commands/lib/registry"

/**
 * next-themes renders an inline script that sets the theme before first
 * paint. It only means anything in server-rendered HTML: a script React
 * renders in the browser never runs, and React says so in the console. That
 * happens whenever Next rebuilds the whole page on the client, as it does for
 * every page that calls `notFound()` (a revoked share link, say). Typing the
 * browser's copy as data keeps React quiet; the server's copy stays a real
 * script, and the attribute that differs between them is not a mismatch.
 */
const CLIENT_SCRIPT_PROPS: React.ComponentProps<
  typeof NextThemesProvider
>["scriptProps"] =
  typeof window === "undefined"
    ? undefined
    : { type: "application/json", suppressHydrationWarning: true }

function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      scriptProps={CLIENT_SCRIPT_PROPS}
      {...props}
    >
      <ThemeHotkey />
      {children}
    </NextThemesProvider>
  )
}

type ThemeContext = { toggle: () => void }

/** App-wide commands: they apply on every page, not only in the studio. */
const appCommands = createRegistry<ThemeContext>([
  {
    id: "view.toggleTheme",
    label: "Toggle dark mode",
    category: "View",
    keybinds: ["d"],
    // A held key flickering the whole page between themes helps nobody.
    repeat: false,
    run: ({ toggle }) => toggle(),
  },
])

function ThemeHotkey() {
  const { resolvedTheme, setTheme } = useTheme()
  useKeybinds(appCommands, {
    toggle: () => setTheme(resolvedTheme === "dark" ? "light" : "dark"),
  })
  return null
}

export { ThemeProvider }
