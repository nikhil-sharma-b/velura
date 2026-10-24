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

import { leafCount } from "../lib/layer-tree"

/** What is about to happen to a layer, waiting on the artist's yes. */
export type LayerConfirmation = {
  layer: LayerSummary
  action: "clear" | "delete"
}

/**
 * Asks before a layer is emptied or deleted: either takes everything on it in
 * one press, which is easy to make by accident and costly to miss.
 */
export function ConfirmLayerDialog({
  confirming,
  onOpenChange,
  onConfirm,
}: {
  confirming: LayerConfirmation | null
  onOpenChange: (open: boolean) => void
  onConfirm: (confirmation: LayerConfirmation) => void
}) {
  const layer = confirming?.layer
  const group = layer?.kind === "group"
  const deleting = confirming?.action === "delete"
  const verb = deleting ? "Delete" : "Clear"
  return (
    <AlertDialog open={!!confirming} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {verb} {layer?.name}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {!deleting
              ? "Everything on this layer will be erased."
              : group
                ? `This group and the ${count(leafCount(layer.children))} in it will be deleted.`
                : "This layer and everything on it will be deleted."}{" "}
            You can undo it afterwards.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => confirming && onConfirm(confirming)}
          >
            {verb} {group ? "group" : "layer"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

const count = (layers: number) =>
  layers === 1 ? "1 layer" : `${layers} layers`
