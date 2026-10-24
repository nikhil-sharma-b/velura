import { describe, expect, test } from "bun:test"

import { createWarmKeeper } from "../../engine/gpu/warm-keeper"

/** A fake clock: timers only fire when the test advances them explicitly. */
function fakeClock() {
  let now = 0
  let nextId = 1
  const timers = new Map<number, { at: number; fn: () => void }>()
  return {
    now: () => now,
    setTimeout(fn: () => void, ms: number) {
      const id = nextId++
      timers.set(id, { at: now + ms, fn })
      return id
    },
    clearTimeout(id: unknown) {
      timers.delete(id as number)
    },
    /** Steps a millisecond at a time, so a timer set by a timer fires when due. */
    advance(ms: number) {
      for (let step = 0; step < ms; step++) {
        now++
        for (const [id, timer] of [...timers])
          if (timer.at <= now) {
            timers.delete(id)
            timer.fn()
          }
      }
    },
    pending: () => timers.size,
  }
}

function keeper(clock: ReturnType<typeof fakeClock>) {
  let warmed = 0
  const kept = createWarmKeeper({
    warm: () => warmed++,
    intervalMs: 800,
    lifetimeMs: 4000,
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  })
  return { kept, warmed: () => warmed }
}

describe("keeping the stroke's textures warm", () => {
  test("nothing is warmed until the artist is at the canvas", () => {
    const clock = fakeClock()
    const { warmed } = keeper(clock)
    clock.advance(10_000)
    expect(warmed()).toBe(0)
    expect(clock.pending()).toBe(0)
  })

  test("arriving after a pause warms at once, ahead of the pen", () => {
    const clock = fakeClock()
    const { kept, warmed } = keeper(clock)
    kept.touch()
    expect(warmed()).toBe(1)
  })

  test("while the artist stays, it warms every interval", () => {
    const clock = fakeClock()
    const { kept, warmed } = keeper(clock)
    kept.touch()
    clock.advance(2400)
    expect(warmed()).toBe(4)
  })

  test("staying costs no warming of its own and no timer", () => {
    const clock = fakeClock()
    const { kept, warmed } = keeper(clock)
    kept.touch()
    for (let i = 0; i < 100; i++) kept.touch()
    expect(warmed()).toBe(1)
    expect(clock.pending()).toBe(1)
  })

  test("it stops a lifetime after the artist was last there", () => {
    const clock = fakeClock()
    const { kept, warmed } = keeper(clock)
    kept.touch()
    clock.advance(1000)
    kept.touch()
    clock.advance(60_000)
    // At 0, then every 800 ms up to 4800: the last touch was at 1000.
    expect(warmed()).toBe(7)
    expect(clock.pending()).toBe(0)
  })

  test("coming back after it stopped warms at once again", () => {
    const clock = fakeClock()
    const { kept, warmed } = keeper(clock)
    kept.touch()
    clock.advance(60_000)
    const before = warmed()
    kept.touch()
    expect(warmed()).toBe(before + 1)
  })

  test("disposed, it warms nothing more", () => {
    const clock = fakeClock()
    const { kept, warmed } = keeper(clock)
    kept.touch()
    kept.dispose()
    clock.advance(10_000)
    kept.touch()
    expect(warmed()).toBe(1)
    expect(clock.pending()).toBe(0)
  })
})
