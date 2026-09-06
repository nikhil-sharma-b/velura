export type RecoveryAction = "retry" | "reload" | "stop"

export type ExplainedFailure = Readonly<{
  action: RecoveryAction
  message: string
}>

function errorText(error: unknown): string {
  if (error instanceof DOMException) return `${error.name}: ${error.message}`
  return error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error)
}

export function explainFailure(
  error: unknown,
  area: "graphics" | "storage" | "upload"
): ExplainedFailure {
  const text = errorText(error)
  if (area === "storage" && /quota|storage.*full|disk.*full/i.test(text))
    return {
      action: "stop",
      message:
        "This device is out of storage. Stop painting for now, free some browser storage, then reload Velura. Your last successfully saved work is still safe.",
    }
  if (area === "upload")
    return {
      action: "retry",
      message:
        "Velura could not upload your latest changes after several tries. They are safe on this device; check your connection and retry saving.",
    }
  if (area === "storage")
    return {
      action: "reload",
      message:
        "Velura could not save to this device. Stop painting and reload before continuing; your last successfully saved work is still safe.",
    }
  return {
    action: "retry",
    message:
      "The graphics device could not be restored. Retry once; if it fails again, reload Velura or restart the browser.",
  }
}
