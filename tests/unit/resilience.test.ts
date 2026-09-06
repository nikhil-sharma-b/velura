import { describe, expect, test } from "bun:test"
import { explainFailure } from "../../engine/errors"

describe("failure guidance", () => {
  test("storage quota exhaustion tells the artist to stop and free space", () => {
    const error = new DOMException(
      "The quota has been exceeded",
      "QuotaExceededError"
    )
    expect(explainFailure(error, "storage")).toEqual({
      action: "stop",
      message:
        "This device is out of storage. Stop painting for now, free some browser storage, then reload Velura. Your last successfully saved work is still safe.",
    })
  })

  test("an exhausted cloud upload tells the artist that retrying is safe", () => {
    expect(explainFailure(new Error("Upload still failed"), "upload")).toEqual({
      action: "retry",
      message:
        "Velura could not upload your latest changes after several tries. They are safe on this device; check your connection and retry saving.",
    })
  })

  test("an unknown local write failure recommends reloading", () => {
    expect(
      explainFailure(new Error("disk unavailable"), "storage").action
    ).toBe("reload")
  })
})
