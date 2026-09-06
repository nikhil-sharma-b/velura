import { describe, expect, test } from "bun:test"

import {
  GRACE_WINDOW_MS,
  planPage,
  referencedHashesOf,
  runSweep,
  type StoredTileObject,
} from "@/convex/lib/collection"
import { fakeLedger, fakeStore } from "./helpers/orphan-collection-fixtures"

const NOW = 1_700_000_000_000
const DAY = 24 * 60 * 60 * 1000

function object(hash: string, age: number, size = 100): StoredTileObject {
  return { hash, size, uploadedAt: NOW - age }
}

/** The half of a page plan these tests are usually asking about. */
function collectableObjects(
  objects: readonly StoredTileObject[],
  referenced: ReadonlySet<string>,
  now: number
): StoredTileObject[] {
  return planPage(objects, referenced, now).collect
}

describe("what a sweep may collect", () => {
  test("an unreferenced object past the grace window is collected", () => {
    const orphan = object("orphan", GRACE_WINDOW_MS + DAY)
    expect(collectableObjects([orphan], new Set(), NOW)).toEqual([orphan])
  })

  test("a referenced object is kept however old it is", () => {
    const live = object("live", 400 * DAY)
    expect(collectableObjects([live], new Set(["live"]), NOW)).toEqual([])
  })

  test("an unreferenced object inside the grace window is kept", () => {
    // The in-flight upload: R2 holds the bytes, but the flush that would
    // name them has not committed yet, so nothing references the hash.
    const inFlight = object("in-flight", 30 * 1000)
    expect(collectableObjects([inFlight], new Set(), NOW)).toEqual([])
  })

  test("the grace window boundary keeps an object exactly at the edge", () => {
    const edge = object("edge", GRACE_WINDOW_MS)
    expect(collectableObjects([edge], new Set(), NOW)).toEqual([])
    expect(
      collectableObjects([object("edge", GRACE_WINDOW_MS + 1)], new Set(), NOW)
    ).toHaveLength(1)
  })

  test("collecting twice over the same input decides the same way", () => {
    const objects = [
      object("orphan", 30 * DAY),
      object("live", 30 * DAY),
      object("young", 60 * 1000),
    ]
    const referenced = new Set(["live"])
    const first = collectableObjects(objects, referenced, NOW)
    const second = collectableObjects(objects, referenced, NOW)
    expect(first).toEqual(second)
    expect(first.map((object) => object.hash)).toEqual(["orphan"])
  })
})

describe("the marked set", () => {
  test("names hashes held by live tile rows and by restore points alike", () => {
    const referenced = referencedHashesOf(
      [{ hash: "document-tile" }, { hash: "shared" }],
      [{ tiles: [{ hash: "version-only" }, { hash: "shared" }] }]
    )
    expect([...referenced].sort()).toEqual([
      "document-tile",
      "shared",
      "version-only",
    ])
  })
})

const at = () => NOW

describe("a sweep", () => {
  test("reclaims orphans and leaves referenced and in-grace objects alone", async () => {
    const objects = [
      object("live-tile", 90 * DAY),
      object("orphan", 90 * DAY),
      object("in-flight", 5 * 1000),
      object("version-only", 90 * DAY),
    ]
    const store = fakeStore(objects)
    const ledger = fakeLedger(["live-tile", "version-only"])

    await runSweep(store.store, ledger.ledger, { now: at })

    expect(store.deleted).toEqual(["orphan"])
    expect([...store.remaining.keys()].sort()).toEqual([
      "in-flight",
      "live-tile",
      "version-only",
    ])
    expect(ledger.forgotten).toEqual(["orphan"])
  })

  test("reports what it scanned and what the grace window held back", async () => {
    const store = fakeStore(
      [
        object("orphan", 90 * DAY),
        object("in-flight-a", 1000),
        object("in-flight-b", 2000),
      ],
      3
    )
    const ledger = fakeLedger([])

    await runSweep(store.store, ledger.ledger, { now: at })

    expect(ledger.batches).toEqual([{ scanned: 3, retainedInGrace: 2 }])
  })

  test("a second sweep over the same store collects nothing more", async () => {
    const store = fakeStore([
      object("live", 90 * DAY),
      object("orphan", 90 * DAY),
    ])
    const ledger = fakeLedger(["live"])

    await runSweep(store.store, ledger.ledger, { now: at })
    const afterFirst = [...store.deleted]
    await runSweep(store.store, ledger.ledger, { now: at })

    expect(store.deleted).toEqual(afterFirst)
    expect([...store.remaining.keys()]).toEqual(["live"])
  })

  test("an interrupted sweep keeps what it reclaimed and finishes on the next run", async () => {
    const store = fakeStore(
      [
        object("orphan-a", 90 * DAY),
        object("live", 90 * DAY),
        object("orphan-b", 90 * DAY),
        object("orphan-c", 90 * DAY),
      ],
      2
    )
    const ledger = fakeLedger(["live"])
    // Dies once the first page's deletion has landed.
    store.failOnDeleteNumber(1)

    await expect(
      runSweep(store.store, ledger.ledger, { now: at })
    ).rejects.toThrow("R2 went away mid-sweep")
    expect(store.deleted).toEqual(["orphan-a"])

    store.failOnDeleteNumber(Number.POSITIVE_INFINITY)
    await runSweep(store.store, ledger.ledger, { now: at })

    expect([...store.remaining.keys()]).toEqual(["live"])
    expect(store.deleted.sort()).toEqual(["orphan-a", "orphan-b", "orphan-c"])
  })

  test("a hash referenced only after the run began is not collected", async () => {
    const store = fakeStore(
      [object("orphan", 90 * DAY), object("adopted", 90 * DAY)],
      1
    )
    const ledger = fakeLedger([])
    // The mark is re-read per page, so a flush that adopts `adopted` by dedup
    // between the two pages is seen before the object is considered.
    const original = ledger.ledger.markedHashes
    let pages = 0
    ledger.ledger.markedHashes = async () => {
      pages += 1
      if (pages > 1) ledger.markedSet.add("adopted")
      return await original.call(ledger.ledger)
    }

    await runSweep(store.store, ledger.ledger, { now: at })

    expect(store.deleted).toEqual(["orphan"])
    expect([...store.remaining.keys()]).toEqual(["adopted"])
  })

  test("the ledger row is dropped before the bytes it names", async () => {
    // If an interruption fell between the two the other way round, the row
    // would outlive the object and `tiles.missingHashes` would tell every
    // later client the tile was already uploaded.
    const store = fakeStore([object("orphan", 90 * DAY)])
    const ledger = fakeLedger([])
    const order: string[] = []
    const forget = ledger.ledger.forgetCollected
    ledger.ledger.forgetCollected = async (hashes: readonly string[]) => {
      order.push("forget")
      await forget.call(ledger.ledger, hashes)
    }
    const deleteObjects = store.store.deleteObjects
    store.store.deleteObjects = async (hashes: readonly string[]) => {
      if (hashes.length > 0) order.push("delete")
      await deleteObjects.call(store.store, hashes)
    }

    await runSweep(store.store, ledger.ledger, { now: at })

    expect(order).toEqual(["forget", "delete"])
  })
})
