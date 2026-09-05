import { createEngine, type Engine } from "../../engine"

declare global {
  interface Window {
    engine: Engine
    remountEngine(): void
    /** Snapshot notifications counted by the stroke tests. */
    strokeNotifications: number
  }
}

const canvas = document.querySelector("canvas")!
window.engine = createEngine(canvas)

window.remountEngine = () => {
  window.engine.dispose()
  window.engine = createEngine(canvas)
}
