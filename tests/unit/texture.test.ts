import { describe, expect, test } from "bun:test"
import {
  builtinTextures,
  CHARCOAL_TIP,
  createTextureLibrary,
  GRAPHITE_TIP,
  type GrayscaleTexture,
  PAPER_GRAIN,
  validateTexture,
} from "../../engine/brush/texture"

const at = (texture: GrayscaleTexture, x: number, y: number) =>
  texture.data[y * texture.width + x]

/** Mean absolute step between two columns: how sharp a seam between them is. */
function columnStep(
  texture: GrayscaleTexture,
  left: number,
  right: number
): number {
  let total = 0
  for (let y = 0; y < texture.height; y++)
    total += Math.abs(at(texture, left, y) - at(texture, right, y))
  return total / texture.height
}

describe("the texture library", () => {
  test("the built-in textures are single-channel and the size they claim", () => {
    for (const texture of Object.values(builtinTextures())) {
      validateTexture(texture)
      expect(texture.data.length).toBe(texture.width * texture.height)
    }
  })

  test("generation is deterministic, so a golden image means something", () => {
    // The textures are generated rather than shipped, which is only safe while
    // two runs produce the same bytes on any machine.
    const first = builtinTextures()
    const second = builtinTextures()
    for (const id of Object.keys(first))
      expect(Buffer.from(second[id].data)).toEqual(Buffer.from(first[id].data))
  })

  test("a tip falls to nothing at its rim", () => {
    // A tip is sampled over the stamp's bounding square, so anything left in
    // the corners would draw outside the dab it belongs to.
    for (const id of [GRAPHITE_TIP, CHARCOAL_TIP]) {
      const tip = builtinTextures()[id]
      const last = tip.width - 1
      for (const [x, y] of [
        [0, 0],
        [last, 0],
        [0, last],
        [last, last],
      ])
        expect(at(tip, x, y)).toBe(0)
      expect(at(tip, tip.width / 2, tip.height / 2)).toBeGreaterThan(0)
    }
  })

  test("a tip is textured, not a flat disc", () => {
    // The whole point of D24: graphite must read as graphite. A tip whose core
    // was uniform would be the procedural disc with extra steps.
    const tip = builtinTextures()[GRAPHITE_TIP]
    const core: number[] = []
    for (let y = 56; y < 72; y++)
      for (let x = 56; x < 72; x++) core.push(at(tip, x, y))
    expect(Math.max(...core) - Math.min(...core)).toBeGreaterThan(20)
  })

  test("grain tiles without a seam", () => {
    // Grain is sampled in canvas space through a repeating sampler, so the
    // texture meets itself across the whole canvas. A lattice that did not
    // wrap would print that join as a grid over every stroke.
    const paper = builtinTextures()[PAPER_GRAIN]
    const last = paper.width - 1
    const seam = columnStep(paper, last, 0)
    const interior = columnStep(paper, 100, 101)
    // A lattice that did not wrap would step by as much as two unrelated
    // columns do — several times this — so the margin is the whole claim.
    expect(seam).toBeLessThan(interior * 1.5)
  })

  test("grain uses the whole range, because depth thresholds against it", () => {
    // The renderer cuts the tooth at a threshold set by grain depth, so what a
    // given depth means depends on where these peaks and valleys sit. A paper
    // that used half the range would silently halve every brush's depth.
    const paper = builtinTextures()[PAPER_GRAIN]
    const values = Array.from(paper.data)
    expect(Math.min(...values)).toBe(0)
    expect(Math.max(...values)).toBe(255)
    // And it is mostly surface rather than mostly hole: a mark at moderate
    // depth is textured, not eaten away.
    const mean = values.reduce((total, v) => total + v, 0) / values.length
    expect(mean).toBeGreaterThan(100)
    expect(mean).toBeLessThan(180)
  })

  test("a texture is resolved by id, and an unknown id resolves to nothing", () => {
    const library = createTextureLibrary()
    expect(library.get(PAPER_GRAIN)).toBeDefined()
    expect(library.get("no-such-texture")).toBeUndefined()
    expect(library.ids()).toContain(GRAPHITE_TIP)
  })

  test("an imported texture registers under its own id", () => {
    const library = createTextureLibrary()
    const imported = { width: 2, height: 2, data: new Uint8Array([0, 1, 2, 3]) }
    library.register("imported", imported)
    expect(library.get("imported")).toBe(imported)
  })

  test("a texture whose data does not match its size is refused", () => {
    // Imported assets are input, so the mismatch is caught at the boundary
    // rather than as a torn upload halfway through a stroke.
    const library = createTextureLibrary()
    expect(() =>
      library.register("ragged", {
        width: 4,
        height: 4,
        data: new Uint8Array(9),
      })
    ).toThrow()
    expect(() =>
      library.register("empty", {
        width: 0,
        height: 4,
        data: new Uint8Array(0),
      })
    ).toThrow()
  })
})

test("tip sets register all equally sized frames and reject invalid counts", () => {
  const library = createTextureLibrary({})
  const set = { width: 2, height: 1, frameCount: 4, data: new Uint8Array(8) }
  library.register("set", set)
  expect(library.get("set")).toBe(set)
  for (const frameCount of [0, -1, 1.5, 257])
    expect(() => library.register("bad", { ...set, frameCount })).toThrow()
  expect(() =>
    library.register("bad", { ...set, data: new Uint8Array(7) })
  ).toThrow()
})
