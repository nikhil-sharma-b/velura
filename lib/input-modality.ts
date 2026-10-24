/**
 * Whether the last thing the artist did was with a pointer — mouse, pen or
 * touch — rather than a key. Watched once, in the capture phase, so no
 * handler's stopPropagation can hide an input from it.
 */
let pointer = false

if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", () => (pointer = true), true)
  window.addEventListener("keydown", () => (pointer = false), true)
}

export const lastInputWasPointer = () => pointer

/**
 * For a popover's `onCloseAutoFocus`: closed by a key, focus goes back to
 * its trigger so the keyboard keeps its place; closed by a click or a tap,
 * it does not, as a trigger focused that way opens its tooltip under a
 * pointer that has already moved on.
 */
export function returnFocusForKeysOnly(event: Event) {
  if (pointer) event.preventDefault()
}
