import { describe, expect, it } from 'vitest'
import { dbAt, posOf } from '../src/shared/fader'

describe('fader travel', () => {
  it('puts 0 dB high up and -inf at the bottom', () => {
    expect(posOf(0)).toBeCloseTo(0.85, 5)
    expect(posOf(-144)).toBe(0)
    expect(posOf(10)).toBe(1)
    expect(posOf(40)).toBe(1)
  })
  it('is its own inverse', () => {
    for (const db of [-60, -45, -20, -7.5, 0, 3, 10]) expect(dbAt(posOf(db))).toBeCloseTo(db, 6)
  })
  it('spends more length per dB near 0 dB than far below it', () => {
    expect(posOf(0) - posOf(-10)).toBeGreaterThan((posOf(-40) - posOf(-50)) * 0.9 * 1.0)
    expect((posOf(0) - posOf(-10)) / 10).toBeGreaterThan((posOf(-40) - posOf(-60)) / 20)
  })
})
