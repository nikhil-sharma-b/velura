import { describe, expect, test } from "bun:test"

import {
  dragCarriesFile,
  firstImageFile,
  layerNameForFile,
} from "@/features/studio/lib/image-import"

/** A stand-in for what a drop or a paste hands over. */
function transfer(options: {
  files?: File[]
  items?: { kind: string; type: string; file?: File }[]
  types?: string[]
}): DataTransfer {
  return {
    files: options.files ?? [],
    items: (options.items ?? []).map((item) => ({
      ...item,
      getAsFile: () => item.file ?? null,
    })),
    types: options.types ?? [],
  } as unknown as DataTransfer
}

const png = (name: string) =>
  new File([new Uint8Array(1)], name, {
    type: "image/png",
  })

describe("what a drop or a paste is carrying", () => {
  test("finds the image among files of other kinds", () => {
    const image = png("scan.png")
    expect(
      firstImageFile(
        transfer({
          files: [new File(["x"], "notes.txt", { type: "text/plain" }), image],
        })
      )
    ).toBe(image)
  })

  test("falls back to the items, which is where a screenshot arrives", () => {
    // A copied screenshot reaches the clipboard as an item with no file list
    // behind it in some browsers, so reading `files` alone would lose it.
    const image = png("image.png")
    expect(
      firstImageFile(
        transfer({ items: [{ kind: "file", type: "image/png", file: image }] })
      )
    ).toBe(image)
  })

  test("is nothing when what came over is not an image", () => {
    expect(
      firstImageFile(
        transfer({
          files: [new File(["x"], "notes.txt", { type: "text/plain" })],
          items: [{ kind: "string", type: "text/plain" }],
        })
      )
    ).toBeNull()
  })

  test("a drag says it carries a file before it can say which", () => {
    // Contents cannot be read mid-drag, so the hint over the canvas goes by
    // the kind alone; whether it was an image is the drop's answer.
    expect(dragCarriesFile(transfer({ types: ["Files"] }))).toBe(true)
    expect(
      dragCarriesFile(transfer({ items: [{ kind: "file", type: "" }] }))
    ).toBe(true)
    expect(dragCarriesFile(transfer({ types: ["text/plain"] }))).toBe(false)
    expect(dragCarriesFile(null)).toBe(false)
  })
})

describe("what a placed image's layer is called", () => {
  test("is the file's name without the extension it was stored under", () => {
    expect(layerNameForFile("Study 3.final.png")).toBe("Study 3.final")
  })

  test("falls back to something sayable when the file has no usable name", () => {
    expect(layerNameForFile(".png")).toBe("Image")
    expect(layerNameForFile("  ")).toBe("Image")
  })
})
