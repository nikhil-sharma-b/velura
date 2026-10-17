"use client"

import { type ComponentProps, createContext, useContext, useRef } from "react"
import { Popover as PopoverPrimitive } from "radix-ui"

/**
 * What the parts of one popover share. A modal popover is dismissed by the
 * press outside it, and the trigger counts as outside. The dismissal unmounts
 * the modal layer, so the click that ends the press reaches the trigger and
 * opens the popover again: a second click on the trigger would close and
 * reopen it, never close it. A dismissal by a press on the trigger is
 * marked so the trigger can swallow its click. The refs stay in `Root`;
 * the parts reach them through these functions.
 */
type Shared = {
  modal: boolean
  setTrigger: (node: HTMLElement | null) => void
  /** Notes whether a press outside the content landed on the trigger. */
  markDismissal: (target: EventTarget | null) => void
  /** Forgets the mark, for a fresh press on the trigger. */
  clearDismissal: () => void
  /** Whether the click is the tail of a dismissal, clearing the mark. */
  takeDismissal: () => boolean
}

const PopoverContext = createContext<Shared | null>(null)

function Root({
  modal = false,
  ...props
}: ComponentProps<typeof PopoverPrimitive.Root>) {
  const trigger = useRef<HTMLElement | null>(null)
  const dismissedByTrigger = useRef(false)
  const shared: Shared = {
    modal,
    setTrigger: (node) => {
      trigger.current = node
    },
    markDismissal: (target) => {
      dismissedByTrigger.current =
        target instanceof Node && !!trigger.current?.contains(target)
    },
    clearDismissal: () => {
      dismissedByTrigger.current = false
    },
    takeDismissal: () => {
      const dismissed = dismissedByTrigger.current
      dismissedByTrigger.current = false
      return dismissed
    },
  }
  return (
    <PopoverContext value={shared}>
      <PopoverPrimitive.Root modal={modal} {...props} />
    </PopoverContext>
  )
}

function Trigger({
  onClick,
  onPointerDown,
  ref,
  ...props
}: ComponentProps<typeof PopoverPrimitive.Trigger>) {
  const shared = useContext(PopoverContext)
  return (
    <PopoverPrimitive.Trigger
      {...props}
      ref={(node) => {
        shared?.setTrigger(node)
        if (typeof ref === "function") ref(node)
        else if (ref) ref.current = node
      }}
      onPointerDown={(event) => {
        // A press that reaches the trigger is a fresh one, not the tail of a
        // dismissal.
        shared?.clearDismissal()
        onPointerDown?.(event)
      }}
      onClick={(event) => {
        if (shared?.takeDismissal()) {
          event.preventDefault()
          return
        }
        onClick?.(event)
      }}
    />
  )
}

/**
 * An anchor that is also pressed to toggle the popover, as a rail button is
 * when its own handler decides what the press does. The guard is a capture
 * handler that stops the swallowed click before the button's own handler sees
 * it.
 */
function Anchor({
  onClickCapture,
  onPointerDown,
  ref,
  ...props
}: ComponentProps<typeof PopoverPrimitive.Anchor>) {
  const shared = useContext(PopoverContext)
  return (
    <PopoverPrimitive.Anchor
      {...props}
      ref={(node) => {
        shared?.setTrigger(node)
        if (typeof ref === "function") ref(node)
        else if (ref) ref.current = node
      }}
      onPointerDown={(event) => {
        shared?.clearDismissal()
        onPointerDown?.(event)
      }}
      onClickCapture={(event) => {
        if (shared?.takeDismissal()) {
          event.stopPropagation()
          return
        }
        onClickCapture?.(event)
      }}
    />
  )
}

function Content({
  onPointerDownOutside,
  ...props
}: ComponentProps<typeof PopoverPrimitive.Content>) {
  const shared = useContext(PopoverContext)
  return (
    <PopoverPrimitive.Content
      {...props}
      onPointerDownOutside={(event) => {
        // Only a modal popover needs this: a non-modal one already ignores a
        // press on its trigger and lets the click toggle it.
        if (shared?.modal) shared.markDismissal(event.target)
        onPointerDownOutside?.(event)
      }}
    />
  )
}

/** Radix's popover, with the trigger toggling it shut as well as open. */
export const Popover = {
  Root,
  Trigger,
  Content,
  Portal: PopoverPrimitive.Portal,
  Anchor,
  Close: PopoverPrimitive.Close,
}
