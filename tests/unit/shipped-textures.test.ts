import { describe, expect, test } from "bun:test"
import { PNG } from "pngjs"

import {
  createShippedTextures,
  type ShippedTextureManifest,
} from "@/features/studio/lib/shipped-textures"

function grayPng(value: number): Uint8Array {
  return new Uint8Array(
    PNG.sync.write(
      Object.assign(new PNG({ width: 1, height: 1 }), {
        data: Buffer.from([value, value, value, 255]),
      }),
      { colorType: 0, inputColorType: 6, bitDepth: 8 }
    )
  )
}

const manifest: ShippedTextureManifest = {
  source: {
    name: "Test",
    repository: "https://example.invalid",
    commit: "abc",
    licence: "CC0-1.0",
    authors: ["Someone"],
  },
  textures: [
    {
      id: "krita:chalk",
      name: "Chalk",
      kind: "tip",
      files: ["tips/chalk.png"],
      source: "brushes/chalk.png",
    },
    {
      id: "krita:grass",
      name: "Grass",
      kind: "tip",
      files: ["tips/grass-0.png", "tips/grass-1.png"],
      source: "brushes/grass.gih",
      selection: "random",
    },
    {
      id: "krita:canvas",
      name: "Canvas",
      kind: "grain",
      files: ["grain/canvas.png"],
      source: "patterns/01_canvas.png",
    },
  ],
}

function fakeFetch(files: Record<string, Uint8Array>) {
  const requested: string[] = []
  const fetch = async (url: string) => {
    requested.push(url)
    const body = files[url]
    return body
      ? new Response(body as BodyInit)
      : new Response(null, { status: 404 })
  }
  return { fetch, requested }
}

describe("the shipped texture library", () => {
  test("lists what it has without fetching any of it", () => {
    const { fetch, requested } = fakeFetch({})
    const shipped = createShippedTextures(manifest, "/brushes/krita", fetch)
    expect(shipped.has("krita:chalk")).toBe(true)
    expect(shipped.has("paper")).toBe(false)
    expect(shipped.ofKind("grain").map((t) => t.id)).toEqual(["krita:canvas"])
    expect(requested).toEqual([])
  })

  test("fetches and decodes a texture on first use, and only once", async () => {
    const { fetch, requested } = fakeFetch({
      "/brushes/krita/tips/chalk.png": grayPng(77),
    })
    const shipped = createShippedTextures(manifest, "/brushes/krita", fetch)
    const [first, second] = await Promise.all([
      shipped.load("krita:chalk"),
      shipped.load("krita:chalk"),
    ])
    expect(first?.data).toEqual(new Uint8Array([77]))
    expect(second).toBe(first)
    expect(requested).toEqual(["/brushes/krita/tips/chalk.png"])
  })

  test("stands a tip set in with its first frame until tip sets can draw", async () => {
    const { fetch, requested } = fakeFetch({
      "/brushes/krita/tips/grass-0.png": grayPng(5),
    })
    const shipped = createShippedTextures(manifest, "/brushes/krita", fetch)
    expect((await shipped.load("krita:grass"))?.data).toEqual(
      new Uint8Array([5])
    )
    expect(requested).toEqual(["/brushes/krita/tips/grass-0.png"])
  })

  test("resolves an id it does not ship to nothing, without fetching", async () => {
    const { fetch, requested } = fakeFetch({})
    const shipped = createShippedTextures(manifest, "/brushes/krita", fetch)
    expect(await shipped.load("paper")).toBeUndefined()
    expect(requested).toEqual([])
  })

  test("tries again after a failed fetch rather than remembering the failure", async () => {
    const files: Record<string, Uint8Array> = {}
    const { fetch, requested } = fakeFetch(files)
    const shipped = createShippedTextures(manifest, "/brushes/krita", fetch)
    await expect(shipped.load("krita:canvas")).rejects.toThrow()
    files["/brushes/krita/grain/canvas.png"] = grayPng(1)
    expect((await shipped.load("krita:canvas"))?.data).toEqual(
      new Uint8Array([1])
    )
    expect(requested).toHaveLength(2)
  })
})
