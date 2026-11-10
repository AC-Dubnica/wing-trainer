import { describe, expect, it } from 'vitest'
import sample from '../fixtures/sample.snap.json'
import { describeChange, diffSnapshots } from '../src/shared/diff'
import { duplicateChannel, freeChannelId, nextFreePort } from '../src/shared/duplicate'
import { MAX_CHANNELS } from '../src/shared/model'
import { mapTracks } from '../src/shared/multitrack'
import { parseSnapshot } from '../src/shared/snapshot'

describe('duplicateChannel', () => {
  it('copies a channel to the lowest free number with a new input and a name', () => {
    const s = parseSnapshot(sample)
    const from = s.channels.find((c) => c.name === 'SINGER 1')!
    const r = duplicateChannel(s, from.id, { grp: 'C', in: 17 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.channel.id).toBe(freeChannelId(parseSnapshot(sample))) // 4 is the first number the sample leaves free
    expect(r.channel.name).toBe('SINGER 1 copy')
    expect(r.channel.source).toEqual({ grp: 'C', in: 17 })
    expect(r.channel.copyOf).toBe(from.id)
    expect(s.channels).toContain(r.channel)
    expect(s.channels.map((c) => c.id)).toEqual([...s.channels.map((c) => c.id)].sort((a, b) => a - b))
  })

  it('copies the whole strip, and the copy is independent of the original', () => {
    const s = parseSnapshot(sample)
    const from = s.channels.find((c) => c.name === 'SINGER 1')!
    const r = duplicateChannel(s, from.id, { grp: 'C', in: 17 }, 'SINGER 6')
    if (!r.ok) throw new Error(r.reason)
    expect(r.channel.name).toBe('SINGER 6')
    expect(r.channel.gate).toEqual(from.gate)
    expect(r.channel.eq).toEqual(from.eq)
    expect(r.channel.sends).toEqual(from.sends)
    expect(r.channel.mains).toEqual(from.mains)
    r.channel.gate.attack = 99
    r.channel.sends[0].level = -3
    expect(from.gate.attack).not.toBe(99)
    expect(from.sends[0].level).not.toBe(-3)
  })

  it('refuses when every channel of the console is used, or there is no input', () => {
    const s = parseSnapshot(sample)
    for (let id = 1; id <= MAX_CHANNELS; id++) if (!s.channels.some((c) => c.id === id)) s.channels.push({ ...structuredClone(s.channels[0]), id })
    expect(duplicateChannel(s, 13, { grp: 'C', in: 17 })).toEqual({ ok: false, reason: `All ${MAX_CHANNELS} channels of the console are in use.` })
    const t = parseSnapshot(sample)
    expect(duplicateChannel(t, 13, { grp: 'OFF', in: 1 }).ok).toBe(false)
    expect(duplicateChannel(t, 99, { grp: 'C', in: 17 }).ok).toBe(false)
  })

  it('suggests the next input port nobody listens to', () => {
    const s = parseSnapshot(sample)
    expect(nextFreePort(s, 'C', 14, 48)).toBe(15) // C 14 is the guitar's; C 15 is free
    expect(nextFreePort(s, 'C', 1, 48)).toBe(10) // C 2 to 9 are taken
  })

  it('shows in the changes, and a recorded track plays on the copy', () => {
    const base = parseSnapshot(sample)
    const now = structuredClone(base)
    const r = duplicateChannel(now, 13, { grp: 'C', in: 2 }, 'SINGER 1 B') // listens to the same input as SINGER 1: the same track
    if (!r.ok) throw new Error(r.reason)
    expect(diffSnapshots(base, now).map(describeChange)).toContain(`Ch ${r.channel.id} SINGER 1 B: Added - -> copy of Ch 13, input C 2`)
    expect(mapTracks(now, ['Track 03.wav']).assigned[0].channels).toEqual([r.channel.id, 13].sort((a, b) => a - b))
  })
})
