import { describe, expect, it } from 'vitest'
import sample from '../fixtures/sample.snap.json'
import { buildFlow, inId, outId, trace } from '../src/shared/flow'
import { parseSnapshot } from '../src/shared/snapshot'

const snap = parseSnapshot(sample)
const flow = buildFlow(snap)
const node = (id: string) => flow.nodes.find((n) => n.id === id)
const edge = (from: string, to: string) => flow.edges.find((e) => e.from === from && e.to === to)

describe('buildFlow', () => {
  it('has a node for every channel, bus, main and matrix of the sample', () => {
    expect(flow.nodes.filter((n) => n.kind === 'ch')).toHaveLength(snap.channels.length)
    expect(flow.nodes.filter((n) => n.kind === 'bus')).toHaveLength(snap.buses.length)
    expect(node('main:1')?.label).toBe('PA')
    expect(node('matrix:1')?.label).toBe('HALL SPEAKERS')
  })

  it('draws the input of a channel, with the name the snapshot gives the port', () => {
    expect(edge(inId('C', 1), 'ch:1')?.kind).toBe('input')
    expect(node(inId('C', 1))?.sub).toBe('PREACHER')
  })

  it('draws a send and a main assignment, and nothing for a send that is off', () => {
    const stream = snap.buses.find((b) => b.name === 'STREAM')!.id
    expect(edge('ch:13', `bus:${stream}`)?.kind).toBe('send')
    expect(edge('ch:13', 'main:1')?.kind).toBe('main')
    const full = snap.buses.find((b) => b.name === 'FULL MIX')!.id
    expect(edge('ch:13', `bus:${full}`)).toBeUndefined() // that send is all the way down
  })

  it('draws the bus to matrix and the patched outputs', () => {
    const stream = snap.buses.find((b) => b.name === 'STREAM')!.id
    expect(edge(`bus:${stream}`, 'matrix:1')?.kind).toBe('matrix')
    expect(edge('main:1', outId('C', 7))?.kind).toBe('patch')
    expect(edge('matrix:1', outId('AES', 1))?.kind).toBe('patch')
  })

  it('passes an input straight to the recorder outputs', () => {
    expect(edge(inId('C', 2), outId('USB', 3))?.kind).toBe('patch')
  })

  it('leaves out an output that is patched to nothing the snapshot names', () => {
    const s = structuredClone(snap)
    s.outputs.push({ grp: 'C', port: 40, source: { grp: 'BUS', in: 99 } })
    expect(buildFlow(s).nodes.some((n) => n.id === outId('C', 40))).toBe(false)
  })
})

describe('trace', () => {
  it('follows the signal both ways: from a microphone to every output it reaches, and back', () => {
    const t = trace(flow.edges, 'ch:13')
    expect(t.has(inId('C', 2))).toBe(true) // where it comes from
    expect(t.has('main:1')).toBe(true)
    expect(t.has(outId('C', 7))).toBe(true) // the PA output
    expect(t.has('ch:14')).toBe(false) // a neighbour that is not on the way
  })

  it('from an output, finds what feeds it', () => {
    const t = trace(flow.edges, outId('AES', 1))
    expect(t.has('matrix:1')).toBe(true)
    expect(t.has('ch:13')).toBe(true) // through the STREAM bus
  })
})
