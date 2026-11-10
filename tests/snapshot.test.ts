import { describe, expect, it } from 'vitest'
import sample from '../fixtures/sample.snap.json'
import { parseRatio, parseSnapshot } from '../src/shared/snapshot'

describe('parseSnapshot', () => {
  const s = parseSnapshot(sample)

  it('reads the channels, buses, mains and the matrix of the sample setup', () => {
    expect(s.channels).toHaveLength(15)
    expect(s.buses.map((b) => b.name)).toContain('STREAM')
    expect(s.mains.map((m) => m.name)).toEqual(['PA', 'SUB'])
    expect(s.matrices.map((m) => m.name)).toEqual(['HALL SPEAKERS'])
    expect(s.firmware).toMatch(/^3\./)
  })

  it('reads a channel with its processing', () => {
    const p = s.channels.find((c) => c.name === 'PREACHER')!
    expect(p.id).toBe(1)
    expect(p.source).toEqual({ grp: 'C', in: 1 })
    expect(p.hasSource).toBe(true)
    expect(p.fader).toBeCloseTo(-3.4, 1)
    expect(p.gate.on).toBe(true)
    expect(p.gate.attack).toBe(20)
    expect(p.comp.ratio).toBe(3)
    expect(p.mains.find((m) => m.main === 1)?.on).toBe(true)
  })

  it('knows which buses a channel sends to', () => {
    const singer = s.channels.find((c) => c.name === 'SINGER 1')!
    const stream = s.buses.find((b) => b.name === 'STREAM')!
    expect(singer.sends.find((x) => x.bus === stream.id)?.on).toBe(true)
  })

  it('reads the sends of the STREAM bus to the matrix, and the recorder patch', () => {
    const stream = s.buses.find((b) => b.name === 'STREAM')!
    expect(stream.matrix.find((m) => m.mtx === 1)?.on).toBe(true)
    expect(s.outputs.find((o) => o.grp === 'USB' && o.port === 14)?.source).toEqual({ grp: 'C', in: 1 })
  })

  it('has no secrets or names in the sample: it is anonymised', () => {
    expect(JSON.stringify(sample)).not.toMatch(/creator_sn|creator_name/)
  })

  it('refuses a file that is not a snapshot', () => {
    expect(() => parseSnapshot({ hello: 1 })).toThrow(/not a WING snapshot/)
    expect(() => parseSnapshot(null)).toThrow()
  })

  it('copes with missing values', () => {
    const tiny = parseSnapshot({ ae_data: { ch: { 1: { name: 'X' } } } })
    expect(tiny.channels[0]).toMatchObject({ name: 'X', mute: false, hasSource: false, gate: { on: false } })
  })
})

describe('parseRatio', () => {
  it('takes the larger side of a ratio written as text', () => {
    expect(parseRatio('1:3')).toBe(3)
    expect(parseRatio('4:1')).toBe(4)
    expect(parseRatio(3.5)).toBe(3.5)
    expect(parseRatio('nonsense', 2)).toBe(2)
  })
})

describe('stereo inputs', () => {
  const s = parseSnapshot(sample)
  it('reads the mode of the input ports', () => {
    expect(s.inputs.find((p) => p.grp === 'C' && p.port === 9)?.mode).toBe('ST')
    expect(s.inputs.find((p) => p.grp === 'C' && p.port === 10)?.mode).toBe('ST')
    expect(s.inputs.find((p) => p.grp === 'C' && p.port === 2)?.mode).toBe('M')
    expect(s.inputs.find((p) => p.grp === 'AUX' && p.port === 1)?.mode).toBe('M/S')
  })
  it('knows which channels are stereo: the piano (C 9 and C 10), the computer (USB 1 and 2), the external input (mid/side)', () => {
    expect(s.channels.find((c) => c.name === 'PIANO')!.stereo).toBe('ST')
    expect(s.channels.find((c) => c.name === 'COMPUTER')!.stereo).toBe('ST')
    expect(s.channels.find((c) => c.name === 'EXT INPUT')!.stereo).toBe('MS')
    expect(s.channels.find((c) => c.name === 'SINGER 1')!.stereo).toBeNull()
    expect(s.channels.find((c) => c.name === 'PREACHER')!.stereo).toBeNull()
  })
})
