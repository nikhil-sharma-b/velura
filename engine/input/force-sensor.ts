/**
 * Whether the device drawing a stroke measures force (smudge 07).
 *
 * A mouse or trackpad has no sensor, and a finger on glass reports a constant
 * stand-in. A pen is the one device that may measure force, but announcing
 * itself as a pen is not the same as having a sensor: one without reports the
 * same stand-in for as long as it is down, and read as a press it would pin
 * every pressure mapping partway up its range.
 *
 * The two are told apart by the only thing that differs, which is whether the
 * pressure ever leaves the stand-in. A pen is read as having no sensor while
 * every sample of its stroke sits exactly on that value, and as measuring
 * force from the first sample that does not, for the rest of the stroke. A
 * real pen lands lightly, so it is trusted from its first sample all but
 * always; one that lands exactly on the stand-in draws at a full press until
 * its next reading. A pen held steady anywhere else is never doubted.
 */

/** What the Pointer Events spec has a device without a sensor report while it is down. */
export const STAND_IN_PRESSURE = 0.5

export interface ForceSensorWatch {
  /** The pen went down. Whether the stroke opens as one whose force is measured. */
  begin(pointerType: string, pressure: number): boolean
  /** One more reading while the pen is down. Whether force is measured, this sample included. */
  read(pressure: number): boolean
}

export function createForceSensorWatch(): ForceSensorWatch {
  let pen = false
  let sensed = false
  return {
    begin(pointerType, pressure) {
      pen = pointerType === "pen"
      sensed = pen && pressure !== STAND_IN_PRESSURE
      return sensed
    },
    read(pressure) {
      if (pen && pressure !== STAND_IN_PRESSURE) sensed = true
      return sensed
    },
  }
}
