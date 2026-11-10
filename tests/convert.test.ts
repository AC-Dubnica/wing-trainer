import { describe, expect, it } from 'vitest'
import sample from '../fixtures/sample.snap.json'
import { compParams, cutFilters, dbToGain, eqBands, gainToDb, gateParams, panValue } from '../src/shared/convert'
import { parseSnapshot } from '../src/shared/snapshot'

const ch = parseSnapshot(sample).channels

describe('levels', () => {
  it('turns dB into a gain, and the console\'s "off" into silence', () => {
    expect(dbToGain(0)).toBe(1)
    expect(dbToGain(-6)).toBeCloseTo(0.501, 3)
    expect(dbToGain(-144)).toBe(0)
    expect(gainToDb(1)).toBe(0)
    expect(gainToDb(0)).toBe(-100)
  })
  it('keeps the pan within -1 to 1', () => {
    expect(panValue(100)).toBe(1)
    expect(panValue(-250)).toBe(-1)
    expect(panValue(0)).toBe(0)
  })
})

describe('processing parameters', () => {
  const p = ch.find((c) => c.name === 'PREACHER')!
  it('gives the gate worklet its values', () => {
    expect(gateParams(p.gate)).toMatchObject({ enabled: 1, attack: 20, threshold: -67 })
    expect(gateParams({ ...p.gate, attack: 0 }).attack).toBe(0.1) // 0 ms is clamped to what the worklet can do
    expect(gateParams({ ...p.gate, on: false }).enabled).toBe(0)
  })
  it('only simulates the COMP model; limiters and the like pass the signal', () => {
    expect(compParams({ ...p.comp, on: true, model: 'COMP' }).enabled).toBe(1)
    expect(compParams({ ...p.comp, on: true, model: 'L100' }).enabled).toBe(0)
  })
  it('makes six equalizer bands, flat while the EQ is off', () => {
    const on = eqBands({ ...p.eq, on: true })
    expect(on).toHaveLength(6)
    expect(on[0].type).toBe('lowshelf')
    expect(on[5].type).toBe('highshelf')
    expect(eqBands({ ...p.eq, on: false }).every((b) => b.gain === 0)).toBe(true)
  })
  it('moves an inactive cut out of the way', () => {
    const f = cutFilters({ lowCut: { on: false, freq: 100 }, highCut: { on: true, freq: 8000 } })
    expect(f.low.freq).toBeLessThan(20)
    expect(f.high.freq).toBe(8000)
  })
})
