import type { DocumentStructure } from "../../../engine/doc/structure"

export function emptyStructure(seed: string): DocumentStructure {
  return {
    activeLayerId: `layer-${seed}`,
    layers: [
      {
        kind: "raster",
        id: `layer-${seed}`,
        name: "Paint Layer 1",
        blend: "normal",
        opacity: 1,
        visible: true,
        locked: false,
        clip: false,
      },
    ],
    paintingMask: false,
  }
}
