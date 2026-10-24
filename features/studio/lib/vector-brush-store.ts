import type { VectorBrush } from "@/engine/brush/vector-brush"

export type VectorBrushLibrary = Readonly<{
  brushes: readonly VectorBrush[]
  loaded: boolean
}>
export type VectorBrushStore = Readonly<{
  useVectorBrushLibrary(): VectorBrushLibrary
  save(brush: VectorBrush): Promise<string>
  update(id: string, brush: VectorBrush): Promise<unknown>
  rename(id: string, name: string): Promise<unknown>
  remove(id: string): Promise<unknown>
}>
