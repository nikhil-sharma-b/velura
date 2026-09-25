"use client"

import * as React from "react"
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes"

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

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  )
}

function ThemeHotkey() {
  const { resolvedTheme, setTheme } = useTheme()

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat) {
        return
      }

      if (event.metaKey || event.ctrlKey || event.altKey) {
        return
      }

      // Chrome's autofill dispatches a keydown with no `key` at all when a
      // saved entry is picked, whatever the type says.
      if (typeof event.key !== "string" || event.key.toLowerCase() !== "d") {
        return
      }

      if (isTypingTarget(event.target)) {
        return
      }

      setTheme(resolvedTheme === "dark" ? "light" : "dark")
    }

    window.addEventListener("keydown", onKeyDown)

    return () => {
      window.removeEventListener("keydown", onKeyDown)
    }
  }, [resolvedTheme, setTheme])

  return null
}

export { ThemeProvider }
