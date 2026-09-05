import { createEngine, type Engine } from "../../engine"

declare global {
  interface Window {
    engine: Engine
    remountEngine(): void
  }
}

const canvas = document.querySelector("canvas")!
window.engine = createEngine(canvas)

window.remountEngine = () => {
  window.engine.dispose()
  window.engine = createEngine(canvas)
}
