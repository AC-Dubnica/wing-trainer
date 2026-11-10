import { describe, expect, it } from 'vitest'
import sample from '../fixtures/sample.snap.json'
import { describeChange, diffSnapshots } from '../src/shared/diff'
import { buildFlow } from '../src/shared/flow'
import { addBus, addMatrix, freeBusId, freeMatrixId, removeBus, removeMatrix, renameMix } from '../src/shared/mixes'
import { MAX_BUSES, MAX_MATRICES } from '../src/shared/model'
import { parseSnapshot } from '../src/shared/snapshot'

const fresh = () => parseSnapshot(sample)

describe('buses', () => {
  it('adds a bus on the lowest free number, with nothing sent to it', () => {
    const s = fresh()
    const id = freeBusId(s)!
    const b = addBus(s, 'MON SINGER 3')!
    expect(b.id).toBe(id)
    expect(b.name).toBe('MON SINGER 3')
    expect(s.buses.map((x) => x.id)).toEqual([...s.buses.map((x) => x.id)].sort((p, q) => p - q))
    expect(b.mains.every((m) => !m.on)).toBe(true)
    expect(b.matrix.every((m) => !m.on)).toBe(true)
    for (const c of s.channels) expect(c.sends.find((x) => x.bus === id)).toMatchObject({ on: false, level: -144 })
  })

  it('names it after its number when no name is given, and keeps names to 16 characters', () => {
    const s = fresh()
    expect(addBus(s, '  ')!.name).toMatch(/^BUS \d+$/)
    expect(addBus(s, 'A VERY LONG NAME FOR A BUS')!.name).toHaveLength(16)
  })

  it('refuses when all 16 buses are used', () => {
    const s = fresh()
    while (s.buses.length < MAX_BUSES) expect(addBus(s, '')).not.toBeNull()
    expect(freeBusId(s)).toBeNull()
    expect(addBus(s, 'ONE MORE')).toBeNull()
  })

  it('removes a bus: its sends go off and the outputs that carried it are unpatched', () => {
    const s = fresh()
    const stream = s.buses.find((b) => b.name === 'STREAM')!.id
    expect(s.outputs.some((o) => o.source.grp === 'BUS' && o.source.in === 7)).toBe(true)
    expect(removeBus(s, stream)).toBe(true)
    expect(s.buses.some((b) => b.id === stream)).toBe(false)
    for (const c of s.channels) expect(c.sends.find((x) => x.bus === stream)).toMatchObject({ on: false })
    expect(removeBus(s, stream)).toBe(false)
    const t = fresh()
    removeBus(t, 7)
    expect(t.outputs.some((o) => o.source.grp === 'BUS' && o.source.in === 7)).toBe(false)
  })

  it('renames a bus, and ignores an empty name', () => {
    const s = fresh()
    expect(renameMix(s, 'bus', 4, 'WEB STREAM')).toBe(true)
    expect(s.buses.find((b) => b.id === 4)!.name).toBe('WEB STREAM')
    expect(renameMix(s, 'bus', 4, '   ')).toBe(false)
    expect(renameMix(s, 'bus', 99, 'X')).toBe(false)
  })

  it('shows in the flow: a send to a removed bus is no longer an edge', () => {
    const s = fresh()
    const stream = s.buses.find((b) => b.name === 'STREAM')!.id
    removeBus(s, stream)
    expect(buildFlow(s).nodes.some((n) => n.id === `bus:${stream}`)).toBe(false)
    expect(buildFlow(s).edges.some((e) => e.to === `bus:${stream}`)).toBe(false)
  })
})

describe('matrices', () => {
  it('adds a matrix that no bus sends to, and every bus has an off send to it', () => {
    const s = fresh()
    const m = addMatrix(s, 'LOBBY')!
    expect(m.id).toBe(freeMatrixId(parseSnapshot(sample)))
    for (const b of s.buses) expect(b.matrix.find((x) => x.mtx === m.id)).toMatchObject({ on: false })
  })

  it('refuses when all 8 matrices are used', () => {
    const s = fresh()
    while (s.matrices.length < MAX_MATRICES) expect(addMatrix(s, '')).not.toBeNull()
    expect(addMatrix(s, 'ONE MORE')).toBeNull()
  })

  it('removes a matrix with its sends and its output patches', () => {
    const s = fresh()
    expect(s.outputs.some((o) => o.source.grp === 'MTX' && o.source.in === 1)).toBe(true)
    expect(removeMatrix(s, 1)).toBe(true)
    expect(s.matrices).toHaveLength(0)
    expect(s.outputs.some((o) => o.source.grp === 'MTX' && o.source.in === 1)).toBe(false)
    expect(s.buses.every((b) => b.matrix.every((m) => !m.on))).toBe(true)
  })
})

describe('the changes', () => {
  it('lists an added, renamed and removed bus and matrix', () => {
    const base = fresh()
    const now = structuredClone(base)
    addBus(now, 'MON NEW')
    renameMix(now, 'bus', 4, 'WEB STREAM')
    removeBus(now, 9)
    addMatrix(now, 'LOBBY')
    renameMix(now, 'matrix', 1, 'HALL')
    const lines = diffSnapshots(base, now).map(describeChange)
    expect(lines.some((l) => /^Bus \d+ MON NEW: Added/.test(l))).toBe(true)
    expect(lines).toContain('Bus 4 STREAM: Name STREAM -> WEB STREAM')
    expect(lines.some((l) => l.startsWith('Bus 9 DELAY: Removed'))).toBe(true)
    expect(lines.some((l) => /^Matrix \d+ LOBBY: Added/.test(l))).toBe(true)
    expect(lines).toContain('Matrix 1 HALL SPEAKERS: Name HALL SPEAKERS -> HALL')
  })
})
