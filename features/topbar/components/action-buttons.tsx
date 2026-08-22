"use client"

import { CloudSlashIcon } from "@phosphor-icons/react"
import { AppSettingsDialog } from "./app-settings-dialog"

export function ActionButtons() {
  return (
    <div className="flex items-center gap-3">
      <CloudSlashIcon className="size-4.5 text-muted-foreground transition-colors hover:text-foreground" />
      <AppSettingsDialog />
    </div>
  )
}
