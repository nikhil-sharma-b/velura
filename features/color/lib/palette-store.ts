/**
 * Where palettes live, as a seam rather than a decision.
 *
 * The studio has two hosts: the cloud one mounts inside a Convex provider and
 * keeps palettes on the account, and the anonymous one at `/` mounts outside
 * it and has only this browser. Rather than let the picker branch on which it
 * is in, the host injects a store — the same shape `remote?: RemoteIndex` has
 * for pixels — so the picker is written once and neither host's storage leaks
 * into it.
 */

export type PaletteRecord = Readonly<{
  id: string
  name: string
  colors: readonly string[]
}>

export type PaletteState = Readonly<{
  palettes: readonly PaletteRecord[]
  /** Newest first. Empty until a colour has actually been painted with. */
  recent: readonly string[]
  /** False while the first read is still outstanding, so the panel can wait. */
  loaded: boolean
}>

export type PaletteStore = Readonly<{
  /** A React hook: called once, unconditionally, at the top of the picker. */
  usePaletteState(): PaletteState
  /** Resolves with the new palette's id, so the caller can go and name it. */
  create(name: string, colors: readonly string[]): Promise<string>
  rename(id: string, name: string): Promise<unknown>
  remove(id: string): Promise<unknown>
  addColor(id: string, hex: string): Promise<unknown>
  removeColorAt(id: string, index: number): Promise<unknown>
  reorder(id: string, from: number, to: number): Promise<unknown>
  recordUsed(hex: string): Promise<unknown>
}>
