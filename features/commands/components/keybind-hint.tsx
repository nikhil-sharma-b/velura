"use client"

import { Kbd } from "@/components/ui/kbd"

import { useKeybindLabel } from "../hooks/use-keybinds"
import type { Registry } from "../lib/registry"

/**
 * A command's keybind as a tooltip or menu shows it, read from the registry
 * so no control keeps its own copy to drift from what the key really does.
 */
export function KeybindHint<Context>({
  registry,
  id,
}: {
  registry: Registry<Context>
  id: string
}) {
  const label = useKeybindLabel(registry, id)
  if (!label) return null
  return <Kbd>{label}</Kbd>
}
