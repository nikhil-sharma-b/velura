import { describe, expect, test } from "bun:test"

import { readGbr, readGih, readPat } from "@/engine/brush/gimp-resources"

/** Big-endian u32s, as every GIMP resource header is written. */
function words(...values: number[]): Uint8Array {
  const bytes = new Uint8Array(values.length * 4)
  const view = new DataView(bytes.buffer)
  values.forEach((value, i) => view.setUint32(i * 4, value))
  return bytes
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

const text = (value: string) => new TextEncoder().encode(value)
const GIMP = text("GIMP")

/** A version 2 brush: header, magic, spacing, NUL-terminated name, pixels. */
function gbr(
  name: string,
  width: number,
  height: number,
  bytes: number,
  pixels: number[],
  spacing = 25
): Uint8Array {
  const label = concat(text(name), new Uint8Array([0]))
  const header = 28 + label.length
  return concat(
    words(header, 2, width, height, bytes),
    GIMP,
    words(spacing),
    label,
    new Uint8Array(pixels)
  )
}

describe("a GIMP brush (.gbr)", () => {
  test("reads a greyscale version 2 brush as ink, one byte per texel", () => {
    const brush = readGbr(gbr("Dot", 2, 2, 1, [0, 255, 128, 0], 40))
    expect(brush).toEqual({
      name: "Dot",
      width: 2,
      height: 2,
      channels: 1,
      spacing: 40,
      pixels: new Uint8Array([0, 255, 128, 0]),
    })
  })

  test("reads a colour brush as four channels", () => {
    const brush = readGbr(gbr("Red", 1, 1, 4, [255, 0, 0, 200]))
    expect(brush.channels).toBe(4)
    expect(brush.pixels).toEqual(new Uint8Array([255, 0, 0, 200]))
  })

  test("reads a version 1 brush, which has no magic and no spacing", () => {
    const label = concat(text("Old"), new Uint8Array([0]))
    const brush = readGbr(
      concat(words(20 + label.length, 1, 1, 1, 1), label, new Uint8Array([9]))
    )
    expect(brush).toMatchObject({ name: "Old", width: 1, channels: 1 })
    expect(brush.pixels).toEqual(new Uint8Array([9]))
  })

  test("refuses a file whose pixels are cut short", () => {
    expect(() => readGbr(gbr("Short", 4, 4, 1, [1, 2, 3]))).toThrow()
  })

  test("refuses a file that is not a brush", () => {
    const bytes = gbr("Bad", 1, 1, 1, [0])
    bytes.set(text("NOPE"), 20)
    expect(() => readGbr(bytes)).toThrow()
  })
})

describe("a GIMP image hose (.gih)", () => {
  test("reads every cell, with the name and how a cell is chosen", () => {
    const hose = readGih(
      concat(
        text("Grass\n"),
        text("2 ncells:2 cellwidth:1 cellheight:1 dim:1 rank0:2 sel0:random\n"),
        gbr("a", 1, 1, 1, [10]),
        gbr("b", 1, 1, 1, [20])
      )
    )
    expect(hose.name).toBe("Grass")
    expect(hose.selection).toBe("random")
    expect(hose.cells.map((cell) => cell.pixels[0])).toEqual([10, 20])
  })

  test("refuses a hose holding fewer cells than it declares", () => {
    expect(() =>
      readGih(
        concat(text("Few\n"), text("3 ncells:3\n"), gbr("a", 1, 1, 1, [1]))
      )
    ).toThrow()
  })
})

describe("a GIMP pattern (.pat)", () => {
  test("reads the pattern's pixels and how many channels they have", () => {
    const label = concat(text("Weave"), new Uint8Array([0]))
    const pattern = readPat(
      concat(
        words(24 + label.length, 1, 2, 1, 3),
        text("GPAT"),
        label,
        new Uint8Array([1, 2, 3, 4, 5, 6])
      )
    )
    expect(pattern).toEqual({
      name: "Weave",
      width: 2,
      height: 1,
      channels: 3,
      pixels: new Uint8Array([1, 2, 3, 4, 5, 6]),
    })
  })
})
