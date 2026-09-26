"use client"

import { useEffect, useRef, useSyncExternalStore } from "react"

import { detectPlatform, formatChord, type Platform } from "../lib/chord"
import type { Registry } from "../lib/registry"
import { createKeybindResolver } from "../lib/resolver"

/**
 * Routes the window's keys through a registry while mounted. Keys are bound
 * on the window rather than an element: the artist's hand is on the pen, and
 * the canvas has no focus of its own to hang them off.
 *
 * The context is read when a key arrives, not when the listeners were added,
 * so commands always act on the current state without rebinding each render.
 */
export function useKeybinds<Context>(
  registry: Registry<Context>,
  context: Context,
  enabled = true
) {
  const current = useRef(context)
  useEffect(() => {
    current.current = context
  })
  useEffect(() => {
    if (!enabled) return
    const resolver = createKeybindResolver(registry, () => current.current)
    const down = (event: KeyboardEvent) => void resolver.keydown(event)
    const up = (event: KeyboardEvent) => resolver.keyup(event)
    const blur = () => resolver.blur()
    window.addEventListener("keydown", down)
    window.addEventListener("keyup", up)
    window.addEventListener("blur", blur)
    return () => {
      resolver.blur()
      window.removeEventListener("keydown", down)
      window.removeEventListener("keyup", up)
      window.removeEventListener("blur", blur)
    }
  }, [registry, enabled])
}

/** The keyboard never changes under a running tab, so there is nothing to watch. */
const subscribeToPlatform = () => () => {}
// The server has no keyboard to name; it renders the non-Mac spelling and the
// client corrects it as it hydrates.
const serverPlatform = (): Platform => "other"

export function usePlatform(): Platform {
  return useSyncExternalStore(
    subscribeToPlatform,
    detectPlatform,
    serverPlatform
  )
}

/**
 * How a command's first keybind reads on this keyboard, or nothing for a
 * command without one — for tooltips and menus, which show what the registry
 * says rather than keeping a list of their own.
 */
export function useKeybindLabel<Context>(
  registry: Registry<Context>,
  id: string
): string | undefined {
  const platform = usePlatform()
  const chord = registry.keybinds(id)[0]
  return chord === undefined ? undefined : formatChord(chord, platform)
}
