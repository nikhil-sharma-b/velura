"use client"

import { FilePlusIcon } from "@phosphor-icons/react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

/**
 * An anonymous studio's way to a fresh piece. It has one document and no
 * library to start another from, so a new artwork is this one cleared — and
 * asked about first, because nothing else holds a copy of it.
 */
export function NewArtworkButton({
  disabled,
  onConfirm,
}: {
  disabled?: boolean
  onConfirm(): void
}) {
  return (
    <AlertDialog>
      <TooltipProvider delayDuration={350}>
        <Tooltip>
          <TooltipTrigger asChild>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="New artwork"
                disabled={disabled}
                className="rounded-lg"
              >
                <FilePlusIcon />
              </Button>
            </AlertDialogTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={8}>
            New artwork
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Start a new artwork?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes every layer and mark from this canvas. Its size stays
            the same, ready for a new piece. Export a backup first to keep this
            one.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep artwork</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>
            Clear canvas
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
