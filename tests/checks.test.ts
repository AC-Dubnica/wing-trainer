import { describe, expect, it } from 'vitest'
import sample from '../fixtures/sample.snap.json'
import { checkChannel, checkSnapshot } from '../src/shared/checks'
import { parseSnapshot } from '../src/shared/snapshot'

const snap = parseSnapshot(sample)

describe('checks', () => {
  it('finds a gate that opens too fast', () => {
    const p = snap.channels.find((c) => c.name === 'PREACHER')!
    const f = checkChannel({ ...p, gate: { ...p.gate, attack: 0 } })
    expect(f.find((x) => x.kind === 'gate-attack')?.severity).toBe('warn')
  })

  it('finds no gate trouble in the sample setup (its attacks are 10 to 20 ms)', () => {
    expect(checkSnapshot(snap).map((x) => x.kind)).not.toContain('gate-attack')
  })

  it('notes the compressor of the preacher that has no make-up gain', () => {
    expect(checkChannel(snap.channels.find((c) => c.name === 'PREACHER')!).map((x) => x.kind)).toContain('no-makeup')
  })

  it('has nothing to say about a gate with a safe attack', () => {
    const c = { ...snap.channels.find((x) => x.name === 'PREACHER')!, gate: { ...snap.channels[0].gate, attack: 10 } }
    expect(checkChannel(c).map((x) => x.kind)).not.toContain('gate-attack')
  })

  it('warns about a channel that goes nowhere', () => {
    const c = { ...snap.channels.find((x) => x.name === 'PIANO')!, mains: [], sends: [] }
    expect(checkChannel({ ...c, mute: false, fader: -5 }).map((x) => x.kind)).toContain('goes-nowhere')
  })

  it('warns about a fader pushed up', () => {
    expect(checkChannel({ ...snap.channels[0], mute: false, fader: 8 }).map((x) => x.kind)).toContain('fader-high')
  })

  it('lists warnings before notes', () => {
    const all = checkSnapshot(snap)
    const firstNote = all.findIndex((x) => x.severity === 'note')
    expect(all.slice(firstNote).every((x) => x.severity === 'note')).toBe(true)
  })
})
