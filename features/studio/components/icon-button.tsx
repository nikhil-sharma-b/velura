"use client"

import type { ComponentProps, ReactNode } from "react"

import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { KeybindHint } from "@/features/commands/components/keybind-hint"
import { useBoundRegistry } from "@/features/commands/hooks/use-keybind-overrides"

import { studioCommands } from "../lib/studio-commands"

/**
 * A button whose only content is an icon, and so whose only name is its
 * tooltip. One label serves both the pointer and the screen reader, because a
 * control the eye cannot read is a control that must say the same thing twice.
 *
 * An `aria-label` overrides the spoken name only, for a control whose context
 * the eye gets from where it sits — a card's "Share" — and the ear does not.
 * It should start with the label, so what is said matches what is shown.
 *
 * A button that runs a studio command names it, and its tooltip shows the
 * command's keybind as the registry has it. A `detail` adds a second, quieter
 * line under the name, for what the button does that its icon cannot show.
 */
export function IconButton({
  label,
  side = "top",
  sideOffset = 8,
  command,
  detail,
  children,
  ...props
}: ComponentProps<typeof Button> & {
  label: string
  side?: ComponentProps<typeof TooltipContent>["side"]
  sideOffset?: number
  command?: string
  detail?: string
  children: ReactNode
}) {
  const commands = useBoundRegistry(studioCommands)
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
          {command && <KeybindHint registry={commands} id={command} />}
          {detail && (
            <span className="block text-[11px] opacity-70">{detail}</span>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
