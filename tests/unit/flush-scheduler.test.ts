import { describe, expect, test } from "bun:test"

import { createFlushScheduler } from "../../engine/store/flush-scheduler"

/** A fake clock: timers only fire when the test advances them explicitly. */
function fakeClock() {
  let now = 0
  let nextId = 1
  const timers = new Map<number, { at: number; fn: () => void }>()

  function setTimeout(fn: () => void, ms: number) {
    const id = nextId++
    timers.set(id, { at: now + ms, fn })
    return id as unknown as ReturnType<typeof globalThis.setTimeout>
  }
  function clearTimeout(id: unknown) {
    timers.delete(id as number)
  }
  function advance(ms: number) {
    now += ms
    for (const [id, timer] of [...timers]) {
      if (timer.at <= now) {
        timers.delete(id)
        timer.fn()
      }
    }
  }
  return { setTimeout, clearTimeout, advance, pending: () => timers.size }
}

describe("idle flush", () => {
  test("touch pushes the deadline out; flush fires once idle for the full window", () => {
    const clock = fakeClock()
    let flushes = 0
    const scheduler = createFlushScheduler({
      flush: () => flushes++,
      idleMs: 1000,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
    })

    scheduler.touch()
    clock.advance(600)
    scheduler.touch() // another stroke resets the clock
    clock.advance(600)
    expect(flushes).toBe(0) // only 600ms idle since the last touch

    clock.advance(400)
    expect(flushes).toBe(1)
  })

  test("many strokes in a row cost one flush, not one per stroke", () => {
    const clock = fakeClock()
    let flushes = 0
    const scheduler = createFlushScheduler({
      flush: () => flushes++,
      idleMs: 1000,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
    })

    for (let i = 0; i < 50; i++) {
      scheduler.touch()
      clock.advance(10)
    }
    expect(flushes).toBe(0)
    clock.advance(1000)
    expect(flushes).toBe(1)
  })

  test("flushNow runs immediately and cancels the pending idle timer", () => {
    const clock = fakeClock()
    let flushes = 0
    const scheduler = createFlushScheduler({
      flush: () => flushes++,
      idleMs: 1000,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
    })

    scheduler.touch()
    scheduler.flushNow()
    expect(flushes).toBe(1)
    expect(clock.pending()).toBe(0)

    clock.advance(2000)
    expect(flushes).toBe(1) // the cancelled idle timer never fires
  })

  test("dispose cancels a pending timer without flushing", () => {
    const clock = fakeClock()
    let flushes = 0
    const scheduler = createFlushScheduler({
      flush: () => flushes++,
      idleMs: 1000,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
    })

    scheduler.touch()
    scheduler.dispose()
    clock.advance(2000)
    expect(flushes).toBe(0)
  })
})
