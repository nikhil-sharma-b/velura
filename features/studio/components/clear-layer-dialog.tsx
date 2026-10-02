"use client"

import type { LayerSummary } from "@/engine"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

/**
 * Asks before a layer is emptied: clearing wipes every mark on it in one go,
 * which is easy to press by accident and costly to miss.
 */
export function ClearLayerDialog({
  layer,
  onOpenChange,
  onConfirm,
}: {
  layer: LayerSummary | null
  onOpenChange: (open: boolean) => void
  onConfirm: (layer: LayerSummary) => void
}) {
  return (
    <AlertDialog open={!!layer} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Clear {layer?.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            Everything on this layer will be erased. You can undo it afterwards.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => layer && onConfirm(layer)}
          >
            Clear layer
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
