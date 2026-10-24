"use client"

import { useConvex, useQuery } from "convex/react"
import { useEffect } from "react"
import { toast } from "sonner"

import { api } from "@/convex/_generated/api"

import {
  cacheAccountKeybinds,
  readAnonymousKeybinds,
  setKeybindSink,
} from "../hooks/use-keybind-overrides"
import {
  cacheAccountRulers,
  readAnonymousRulers,
  setRulersSink,
} from "@/features/studio/lib/ruler-preference"

import { parseOverrides, type KeybindOverrides } from "../lib/overrides"

/** The overrides in the plain shape a Convex argument takes. */
function mutable(overrides: KeybindOverrides): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(overrides).map(([id, chords]) => [id, [...chords]])
  )
}

/**
 * Keeps this device's keybind and ruler caches and the account's preferences
 * in step.
 * Mounted only while signed in. The cache is what shortcuts read, so they
 * answer from the first keystroke; the account's copy replaces it when the
 * live query resolves, and again whenever another session changes it.
 */
export function PreferencesSync() {
  const convex = useConvex()
  const remote = useQuery(api.preferences.get)

  // Overrides made signed out go up before anything comes down: the claim
  // answers with the merged set, and only then does the cache become a mirror.
  // A failed claim leaves them unmirrored and claimable on the next mount.
  useEffect(() => {
    const local = readAnonymousKeybinds()
    if (Object.keys(local).length === 0) return
    convex
      .mutation(api.preferences.claimKeybinds, { keybinds: mutable(local) })
      .then((merged) => cacheAccountKeybinds(parseOverrides(merged)))
      .catch(() =>
        toast.error(
          "Your shortcuts could not be saved to your account. They remain on this device."
        )
      )
  }, [convex])

  useEffect(() => {
    setKeybindSink((overrides) =>
      convex
        .mutation(api.preferences.setKeybinds, { keybinds: mutable(overrides) })
        .catch(() =>
          toast.error(
            "That shortcut could not be saved to your account. It works on this device."
          )
        )
    )
    return () => setKeybindSink(null)
  }, [convex])

  useEffect(() => {
    setRulersSink((visible) =>
      convex
        .mutation(api.preferences.setRulersVisible, { visible })
        .catch(() =>
          toast.error(
            "Your ruler setting could not be saved to your account. It is kept on this device."
          )
        )
    )
    return () => setRulersSink(null)
  }, [convex])

  // Undefined while loading, null for an account with no choice made; read
  // on its own so a keybind edit coming back does not rewrite the rulers.
  const accountRulers =
    remote === undefined ? undefined : (remote?.rulersVisible ?? null)
  useEffect(() => {
    // Rulers (08): a choice made signed out goes up while the account has
    // none of its own; otherwise the account's choice, once it has one, is
    // mirrored here. With neither, what this device shows stands.
    if (accountRulers === undefined) return
    const local = readAnonymousRulers()
    if (accountRulers === null && local !== null)
      void convex
        .mutation(api.preferences.setRulersVisible, { visible: local })
        .then(() => cacheAccountRulers(local))
        .catch(() => {
          // Kept on this device, and offered to the account again next time.
        })
    else if (accountRulers !== null) cacheAccountRulers(accountRulers)
  }, [accountRulers, convex])

  useEffect(() => {
    // Undefined is still loading and null is an account with nothing stored:
    // either way, what this device has stands. So do unclaimed overrides,
    // which the claim above mirrors once they are safely in the account.
    if (remote && Object.keys(readAnonymousKeybinds()).length === 0)
      cacheAccountKeybinds(parseOverrides(remote.keybinds))
  }, [remote])

  return null
}
