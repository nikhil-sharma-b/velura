import { describe, expect, test } from "bun:test"

import {
  localPreviewIsCurrent,
  previewIsStale,
  reusableSignedUrl,
} from "@/features/library/lib/preview-cache"

describe("this device's own preview", () => {
  test("is shown while its upload is in flight, whatever the server says", () => {
    expect(
      localPreviewIsCurrent({ url: "u", version: undefined, seq: 1 }, 4)
    ).toBe(true)
  })

  test("is shown once committed, until another device commits a later one", () => {
    const local = { url: "u", version: 3, seq: 1 }
    expect(localPreviewIsCurrent(local, 3)).toBe(true)
    expect(localPreviewIsCurrent(local, 4)).toBe(false)
  })

  test("is not there to show when none was made", () => {
    expect(localPreviewIsCurrent(undefined, undefined)).toBe(false)
  })
})

describe("a signed preview URL", () => {
  const entry = { version: 2, url: "https://r2.test/p", signedAt: 0 }

  test("is reused for the same version while comfortably inside its signature", () => {
    expect(reusableSignedUrl(entry, 2, 60_000)).toBe(entry.url)
  })

  test("is not reused for a newer version", () => {
    expect(reusableSignedUrl(entry, 3, 60_000)).toBeUndefined()
  })

  test("is not reused close to its expiry", () => {
    expect(reusableSignedUrl(entry, 2, 11 * 60_000)).toBeUndefined()
  })
})

describe("a card's picture", () => {
  test("is stale while this device syncs changes it has no picture of yet", () => {
    const local = { url: "u", version: 2, seq: 1 }
    expect(previewIsStale({ local, syncingSince: 5 }, 2, 2)).toBe(true)
    expect(previewIsStale({ syncingSince: 5 }, 2, 2)).toBe(true)
  })

  test("is current once that sync has produced its picture", () => {
    const local = { url: "u", version: undefined, seq: 6 }
    expect(previewIsStale({ local, syncingSince: 5 }, 2, 2)).toBe(false)
  })

  test("is stale while an older server preview stands in for a newer one", () => {
    expect(previewIsStale(undefined, 2, 3)).toBe(true)
    expect(previewIsStale(undefined, 3, 3)).toBe(false)
  })

  test("of a blank canvas is not stale", () => {
    expect(previewIsStale(undefined, undefined, undefined)).toBe(false)
  })
})
