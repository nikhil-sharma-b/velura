"use client"

import { CloudSlashIcon } from "@phosphor-icons/react"
import { AppSettingsDialog } from "./app-settings-dialog"

export function ActionButtons() {
  return (
    <div className="flex items-center gap-3">
      <CloudSlashIcon className="size-4.5" />
      <AppSettingsDialog />
    </div>
  )
}
