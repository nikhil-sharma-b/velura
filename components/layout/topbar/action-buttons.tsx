"use client"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { CloudSlashIcon, GearIcon } from "@phosphor-icons/react"

export function ActionButtons() {
  return (
    <div className="flex items-center gap-3">
      <CloudSlashIcon className="size-4.5" />
      <Dialog>
        <DialogTrigger asChild>
          <Button variant="ghost" className="h-11 rounded-full p-2">
            <GearIcon className="size-6" />
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>App settings</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </div>
  )
}
