import { describe, expect, it } from 'vitest'
import sample from '../fixtures/sample.snap.json'
import { describeChange, diffSnapshots } from '../src/shared/diff'
import { parseSnapshot } from '../src/shared/snapshot'

describe('diffSnapshots', () => {
  it('has no changes between a snapshot and itself', () => {
    expect(diffSnapshots(parseSnapshot(sample), parseSnapshot(sample))).toEqual([])
  })

  it('lists what was changed, in words', () => {
    const base = parseSnapshot(sample)
    const now = structuredClone(base)
    const p = now.channels.find((c) => c.name === 'PREACHER')!
    p.gate.attack = 10
    p.fader = -6
    now.buses[0].mute = true
    const changes = diffSnapshots(base, now).map(describeChange)
    expect(changes).toContain('Ch 1 PREACHER: Gate attack 20 ms -> 10 ms')
    expect(changes.some((c) => c.startsWith('Ch 1 PREACHER: Fader'))).toBe(true)
    expect(changes.some((c) => c.includes('Mute off -> on'))).toBe(true)
  })
})
