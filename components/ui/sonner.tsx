"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import {
  CheckCircleIcon,
  InfoIcon,
  WarningIcon,
  XCircleIcon,
  SpinnerIcon,
} from "@phosphor-icons/react"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      position="bottom-center"
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: <CheckCircleIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <WarningIcon className="size-4" />,
        error: <XCircleIcon className="size-4" />,
        loading: <SpinnerIcon className="size-4 animate-spin" />,
      }}
      style={
        {
          // The studio's panel surface and rim rather than --popover: in dark
          // mode --popover is a shade off the canvas matting and the toast
          // disappears into it.
          "--normal-bg": "var(--studio-surface)",
          "--normal-text": "var(--foreground)",
          "--normal-border": "var(--studio-edge)",
          "--border-radius": "var(--radius)",
          // Wider than sonner's 356px default: a sentence that wraps four
          // times reads as a paragraph to be studied, and a toast is glanced
          // at. Sonner still goes full width on narrow screens.
          "--width": "34rem",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast shadow-lg",
          info: "[&_[data-icon]]:text-brand-gold",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
