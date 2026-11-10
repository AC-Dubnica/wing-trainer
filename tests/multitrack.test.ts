import { describe, expect, it } from 'vitest'
import sample from '../fixtures/sample.snap.json'
import { mapTracks, trackNumber } from '../src/shared/multitrack'
import { parseSnapshot } from '../src/shared/snapshot'

describe('trackNumber', () => {
  it('finds the track in common file names', () => {
    expect(trackNumber('Track 03.wav')).toBe(3)
    expect(trackNumber('20260517_07.wav')).toBe(7)
    expect(trackNumber('ch12.flac')).toBe(12)
    expect(trackNumber('mix.wav')).toBeNull()
    expect(trackNumber('2026051712.wav')).toBeNull() // a date, not a track
  })
})

describe('mapTracks after the routing is changed', () => {
  const snap = parseSnapshot(sample)
  it('moves a track to another fader when the channel takes another input', () => {
    const now = structuredClone(snap)
    now.channels.find((c) => c.id === 13)!.source = { grp: 'C', in: 3 } // SINGER 1 now listens to what SINGER 2 had
    const m = mapTracks(now, ['Track 03.wav', 'Track 04.wav'])
    expect(m.assigned.find((a) => a.track === 4)?.channels).toEqual([13, 14]) // both now take input C 3, which is recorder track 4
    expect(m.unmatched).toContain('Track 03.wav') // nobody takes C 2 any more
  })
  it('follows the recorder patch: track 3 can be given another input', () => {
    const now = structuredClone(snap)
    now.outputs.find((o) => o.grp === 'USB' && o.port === 3)!.source = { grp: 'C', in: 1 }
    const preacher = now.channels.find((c) => c.name === 'PREACHER')!.id
    expect(mapTracks(now, ['Track 03.wav']).assigned[0].channels).toEqual([preacher])
  })
})

describe('mapTracks', () => {
  const snap = parseSnapshot(sample)
  it('places a recorder track on the channel patched to the input it recorded', () => {
    const m = mapTracks(snap, ['Track 14.wav', 'Track 03.wav'])
    expect(m.unmatched).toEqual([])
    const preacher = snap.channels.find((c) => c.name === 'PREACHER')!.id
    const singer = snap.channels.find((c) => c.name === 'SINGER 1')!.id
    expect(m.assigned.find((a) => a.track === 14)?.channels).toEqual([preacher])
    expect(m.assigned.find((a) => a.track === 3)?.channels).toEqual([singer])
  })
  it('puts the two channels that share a wireless receiver on the same track', () => {
    expect(mapTracks(snap, ['Track 15.wav']).assigned[0].channels.length).toBeGreaterThanOrEqual(1)
  })
  it('reports files it cannot place', () => {
    const m = mapTracks(snap, ['Track 01.wav', 'notes.txt', 'Track 03.wav', 'Take 03.wav'])
    expect(m.assigned.map((a) => a.track)).toEqual([3])
    expect(m.unmatched).toHaveLength(3) // nothing is patched to recorder track 1, a text file, and the second file for track 3
    expect(m.unmatched).toEqual(expect.arrayContaining(['Track 01.wav', 'notes.txt']))
  })
})
