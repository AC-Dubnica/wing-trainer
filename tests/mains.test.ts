import { describe, expect, it } from 'vitest'
import sample from '../fixtures/sample.snap.json'
import { connect, disconnect, replacement } from '../src/shared/connect'
import { buildFlow, outId } from '../src/shared/flow'
import { mainOfIndex, mainSides, mainSourceCount, mainSourceName } from '../src/shared/mains'
import { parseSnapshot } from '../src/shared/snapshot'

const fresh = () => parseSnapshot(sample)

describe('the MAIN output sources are the sides of the mains', () => {
  it('lists a left and a right for each stereo main', () => {
    const s = fresh()
    expect(s.mainMono).toEqual([false, false, false, false])
    expect(mainSourceCount(s)).toBe(8)
    expect(mainOfIndex(s, 1)).toEqual({ index: 1, main: 1, side: 'L' })
    expect(mainOfIndex(s, 2)).toEqual({ index: 2, main: 1, side: 'R' })
    expect(mainOfIndex(s, 3)).toEqual({ index: 3, main: 2, side: 'L' })
    expect(mainOfIndex(s, 4)).toEqual({ index: 4, main: 2, side: 'R' })
  })
  it('a mono main is one entry and shifts the next ones', () => {
    const s = fresh()
    s.mainMono = [true, false, false, false]
    expect(mainSides(s).slice(0, 3)).toEqual([{ index: 1, main: 1, side: 'M' }, { index: 2, main: 2, side: 'L' }, { index: 3, main: 2, side: 'R' }])
  })
  it('says them in words', () => {
    const s = fresh()
    expect(mainSourceName(s, 1)).toBe('PA left')
    expect(mainSourceName(s, 2)).toBe('PA right')
    expect(mainSourceName(s, 3)).toBe('SUB left')
  })
})

describe('the diagram shows the PA on C 7 and C 8', () => {
  const flow = buildFlow(fresh())
  const edge = (from: string, to: string) => flow.edges.find((e) => e.from === from && e.to === to)
  it('draws main 1 (the PA) to both C 7 and C 8, with the side on the line, and SUB to C 5 and C 6', () => {
    expect(edge('main:1', outId('C', 7))?.label).toBe('L')
    expect(edge('main:1', outId('C', 8))?.label).toBe('R')
    expect(edge('main:2', outId('C', 5))?.label).toBe('L')
    expect(edge('main:2', outId('C', 6))?.label).toBe('R')
    expect(edge('main:2', outId('C', 8))).toBeUndefined() // not the PA's right side
  })
  it('names the side on the output', () => {
    const out = (id: string) => flow.nodes.find((n) => n.id === id)!
    expect(out(outId('C', 7)).sub).toBe('PA left')
    expect(out(outId('C', 8)).sub).toBe('PA right')
    expect(out(outId('REC', 1)).sub).toBe('PA left')
  })
})

describe('connecting a main to an output', () => {
  it('patches the left side to an odd port and the right side to an even port', () => {
    const s = fresh()
    expect(connect(s, 'main:1', 'out:AUX:5')).toMatchObject({ ok: true, message: expect.stringContaining('PA left') })
    expect(s.outputs.find((o) => o.grp === 'AUX' && o.port === 5)!.source).toEqual({ grp: 'MAIN', in: 1 })
    expect(connect(s, 'main:1', 'out:AUX:6').message).toContain('PA right')
    expect(s.outputs.find((o) => o.grp === 'AUX' && o.port === 6)!.source).toEqual({ grp: 'MAIN', in: 2 })
    expect(connect(s, 'main:2', 'out:AUX:4').message).toContain('SUB right')
  })
  it('knows that C 8 carries the PA already, and disconnects the right side', () => {
    const s = fresh()
    expect(connect(s, 'main:1', 'out:C:8')).toMatchObject({ ok: false, message: expect.stringContaining('already carries main PA right') })
    expect(disconnect(s, 'main:1', 'out:C:8').ok).toBe(true)
    expect(s.outputs.some((o) => o.grp === 'C' && o.port === 8)).toBe(false)
  })
  it('the warning says which side would be lost', () => {
    const s = fresh()
    expect(replacement(s, 'main:2', 'out:C:8')).toMatch(/output C 8 carries main PA right now.*PA right will no longer go to output C 8/)
  })
})
