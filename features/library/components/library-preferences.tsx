"use client"

import { PreferencesPanel } from "@/features/commands/components/preferences-panel"
import { studioCommands } from "@/features/studio/lib/studio-commands"

/**
 * The studio's preferences, opened from the library. Its own module so the
 * command list, and the engine it names, load only when it is opened.
 */
export default function LibraryPreferences({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <PreferencesPanel
      defaults={studioCommands}
      open={open}
      onOpenChange={onOpenChange}
    />
  )
}
