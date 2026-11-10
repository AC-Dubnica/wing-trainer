import { describe, expect, it } from 'vitest'
import sample from '../fixtures/sample.snap.json'
import { connect, disconnect, isConnected, parseRef, toggleConnection } from '../src/shared/connect'
import { buildFlow } from '../src/shared/flow'
import { parseSnapshot } from '../src/shared/snapshot'

const fresh = () => parseSnapshot(sample)
const has = (s: ReturnType<typeof fresh>, from: string, to: string) => buildFlow(s).edges.some((e) => e.from === from && e.to === to)

describe('parseRef', () => {
  it('reads the ids of the diagram', () => {
    expect(parseRef('in:C:2')).toEqual({ kind: 'in', grp: 'C', port: 2 })
    expect(parseRef('ch:13')).toEqual({ kind: 'ch', id: 13 })
    expect(parseRef('out:USB:3')).toEqual({ kind: 'out', grp: 'USB', port: 3 })
    expect(parseRef('nonsense')).toBeNull()
  })
})

describe('connect', () => {
  it('gives a channel another input, whichever node is named first', () => {
    const s = fresh()
    expect(connect(s, 'in:C:12', 'ch:13').ok).toBe(true)
    expect(s.channels.find((c) => c.id === 13)!.source).toEqual({ grp: 'C', in: 12 })
    const t = fresh()
    expect(connect(t, 'ch:13', 'in:C:12').ok).toBe(true)
    expect(t.channels.find((c) => c.id === 13)!.source).toEqual({ grp: 'C', in: 12 })
    expect(connect(t, 'in:C:12', 'ch:13').ok).toBe(false) // already
  })

  it('sends a channel to a main and to a bus, starting at unity', () => {
    const s = fresh()
    const c = s.channels.find((x) => x.id === 20)!
    expect(has(s, 'ch:20', 'main:1')).toBe(false)
    expect(connect(s, 'ch:20', 'main:1').ok).toBe(true)
    expect(c.mains.find((m) => m.main === 1)).toMatchObject({ on: true })
    expect(has(s, 'ch:20', 'main:1')).toBe(true)
    const stream = s.buses.find((b) => b.name === 'STREAM')!.id
    c.sends.find((x) => x.bus === stream)!.on = false
    expect(connect(s, 'ch:20', `bus:${stream}`).message).toMatch(/sends to STREAM/)
    expect(has(s, 'ch:20', `bus:${stream}`)).toBe(true)
  })

  it('connects a bus to a main and a bus to a matrix', () => {
    const s = fresh()
    expect(connect(s, 'bus:1', 'main:2').ok).toBe(true)
    expect(has(s, 'bus:1', 'main:2')).toBe(true)
    expect(connect(s, 'matrix:1', 'bus:1').ok).toBe(true) // either way round
    expect(has(s, 'bus:1', 'matrix:1')).toBe(true)
  })

  it('patches an output to a mix or an input, replacing what it carried', () => {
    const s = fresh()
    expect(connect(s, 'main:2', 'out:C:7').ok).toBe(true)
    expect(s.outputs.find((o) => o.grp === 'C' && o.port === 7)!.source).toEqual({ grp: 'MAIN', in: 2 })
    expect(connect(s, 'in:C:5', 'out:AUX:5').ok).toBe(true)
    expect(s.outputs.find((o) => o.grp === 'AUX' && o.port === 5)!.source).toEqual({ grp: 'C', in: 5 })
  })

  it('refuses what makes no sense, and says why', () => {
    const s = fresh()
    expect(connect(s, 'ch:13', 'ch:14')).toMatchObject({ ok: false })
    expect(connect(s, 'ch:13', 'out:C:7').message).toMatch(/main, a bus or a matrix/)
    expect(connect(s, 'main:1', 'matrix:1').ok).toBe(false)
    expect(connect(s, 'ch:99', 'main:1').ok).toBe(false)
  })
})

describe('disconnect', () => {
  it('takes an input away, a main, a send, a bus to a matrix and an output patch', () => {
    const s = fresh()
    const stream = s.buses.find((b) => b.name === 'STREAM')!.id
    expect(disconnect(s, 'in:C:2', 'ch:13').ok).toBe(true)
    expect(s.channels.find((c) => c.id === 13)).toMatchObject({ hasSource: false })
    expect(disconnect(s, 'ch:14', 'main:1').ok).toBe(true)
    expect(has(s, 'ch:14', 'main:1')).toBe(false)
    expect(disconnect(s, 'ch:14', `bus:${stream}`).ok).toBe(true)
    expect(has(s, 'ch:14', `bus:${stream}`)).toBe(false)
    expect(disconnect(s, `bus:${stream}`, 'matrix:1').ok).toBe(true)
    expect(disconnect(s, 'main:1', 'out:C:7').ok).toBe(true)
    expect(s.outputs.some((o) => o.grp === 'C' && o.port === 7)).toBe(false)
  })

  it('says so when they are not connected', () => {
    const s = fresh()
    expect(disconnect(s, 'in:C:12', 'ch:13')).toMatchObject({ ok: false })
    expect(disconnect(s, 'main:2', 'out:C:7')).toMatchObject({ ok: false }) // C 7 carries main 1
  })

  it('connect then disconnect leaves the snapshot as it was (apart from the level the send keeps)', () => {
    const s = fresh()
    const before = structuredClone(s)
    connect(s, 'in:C:12', 'ch:13')
    disconnect(s, 'in:C:12', 'ch:13')
    expect(s.channels.find((c) => c.id === 13)!.hasSource).toBe(false) // the old input is gone: re-connect it to undo
    expect(before.channels.find((c) => c.id === 13)!.hasSource).toBe(true)
  })
})

describe('toggleConnection', () => {
  it('connects what is not connected and disconnects what is', () => {
    const s = fresh()
    expect(isConnected(s, 'ch:20', 'main:1')).toBe(false)
    const first = toggleConnection(s, 'ch:20', 'main:1')
    expect(first).toMatchObject({ ok: true, added: true })
    expect(isConnected(s, 'ch:20', 'main:1')).toBe(true)
    const second = toggleConnection(s, 'main:1', 'ch:20') // either order
    expect(second).toMatchObject({ ok: true, added: false })
    expect(isConnected(s, 'ch:20', 'main:1')).toBe(false)
  })

  it('works for an input, a send and an output', () => {
    const s = fresh()
    expect(toggleConnection(s, 'in:C:2', 'ch:13')).toMatchObject({ added: false }) // C 2 feeds ch 13: it is taken away
    expect(s.channels.find((c) => c.id === 13)!.hasSource).toBe(false)
    expect(toggleConnection(s, 'in:C:2', 'ch:13')).toMatchObject({ added: true })
    expect(s.channels.find((c) => c.id === 13)!.source).toEqual({ grp: 'C', in: 2 })
    expect(toggleConnection(s, 'main:1', 'out:C:7')).toMatchObject({ added: false })
    expect(s.outputs.some((o) => o.grp === 'C' && o.port === 7)).toBe(false)
    expect(toggleConnection(s, 'main:1', 'out:C:7')).toMatchObject({ added: true })
  })

  it('a send that is all the way down counts as not connected, so the gesture connects it', () => {
    const s = fresh()
    const full = s.buses.find((b) => b.name === 'FULL MIX')!.id
    expect(isConnected(s, 'ch:13', `bus:${full}`)).toBe(false)
    expect(toggleConnection(s, 'ch:13', `bus:${full}`)).toMatchObject({ ok: true, added: true })
  })
})
