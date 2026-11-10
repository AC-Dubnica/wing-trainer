import { describe, expect, it } from 'vitest'
import sample from '../fixtures/sample.snap.json'
import { compCurve, eqCurve, gateCurve, responseDb } from '../src/shared/curves'
import { parseSnapshot } from '../src/shared/snapshot'

const ch = parseSnapshot(sample).channels.find((c) => c.name === 'PREACHER')!

describe('eqCurve', () => {
  it('is flat with the EQ off and no cuts', () => {
    const c = eqCurve({ ...ch.eq, on: false }, { lowCut: { on: false, freq: 80 }, highCut: { on: false, freq: 8000 } })
    expect(c.db.every((v) => Math.abs(v) < 0.01)).toBe(true)
    expect(c.freq[0]).toBeCloseTo(20, 0)
    expect(c.freq.at(-1)).toBeCloseTo(20000, 0)
  })
  it('puts a bell where it is set: +6 dB at its centre', () => {
    expect(responseDb({ type: 'peaking', freq: 1000, gain: 6, q: 1 }, 1000)).toBeCloseTo(6, 1)
    expect(Math.abs(responseDb({ type: 'peaking', freq: 1000, gain: 6, q: 1 }, 100))).toBeLessThan(0.5)
  })
  it('shelves reach their gain far from the corner', () => {
    expect(responseDb({ type: 'lowshelf', freq: 200, gain: 6, q: 0.7 }, 20)).toBeCloseTo(6, 0)
    expect(responseDb({ type: 'highshelf', freq: 5000, gain: -6, q: 0.7 }, 20000)).toBeCloseTo(-6, 0)
  })
  it('a low cut takes the bass away', () => {
    const c = eqCurve({ ...ch.eq, on: false }, { lowCut: { on: true, freq: 200 }, highCut: { on: false, freq: 8000 } })
    expect(c.db[0]).toBeLessThan(-20)
    expect(Math.abs(c.db.at(-1)!)).toBeLessThan(0.5)
  })
})

describe('dynamics curves', () => {
  const comp = { on: true, threshold: -20, ratio: 4, knee: 0, makeup: 0 }
  it('leaves a level below the threshold alone and divides the part above it by the ratio', () => {
    expect(compCurve(comp, -40)).toBe(-40)
    expect(compCurve(comp, 0)).toBeCloseTo(-15, 5) // 20 dB over the threshold becomes 5 dB
  })
  it('adds the make-up gain, and passes everything when off', () => {
    expect(compCurve({ ...comp, makeup: 3 }, -40)).toBe(-37)
    expect(compCurve({ ...comp, on: false }, 0)).toBe(0)
  })
  it('the soft knee is continuous at its edges', () => {
    const k = { ...comp, knee: 10 }
    expect(compCurve(k, -25)).toBeCloseTo(-25, 3)
    expect(compCurve(k, -15)).toBeCloseTo(-20 + 5 / 4, 3)
  })
  it('the gate lowers what is under the threshold by the range', () => {
    const g = { on: true, threshold: -40, range: 30 }
    expect(gateCurve(g, -50)).toBe(-80)
    expect(gateCurve(g, -30)).toBe(-30)
    expect(gateCurve({ ...g, on: false }, -50)).toBe(-50)
  })
})
