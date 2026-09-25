"use client"

import type { ComponentProps, ReactNode } from "react"

import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

/**
 * A button whose only content is an icon, and so whose only name is its
 * tooltip. One label serves both the pointer and the screen reader, because a
 * control the eye cannot read is a control that must say the same thing twice.
 *
 * An `aria-label` overrides the spoken name only, for a control whose context
 * the eye gets from where it sits — a card's "Share" — and the ear does not.
 * It should start with the label, so what is said matches what is shown.
 */
export function IconButton({
  label,
  side = "top",
  sideOffset = 8,
  children,
  ...props
}: ComponentProps<typeof Button> & {
  label: string
  side?: ComponentProps<typeof TooltipContent>["side"]
  sideOffset?: number
  children: ReactNode
}) {
  return (
    <TooltipProvider delayDuration={350}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button {...props} aria-label={props["aria-label"] ?? label}>
            {children}
          </Button>
        </TooltipTrigger>
        <TooltipContent side={side} sideOffset={sideOffset}>
          {label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
