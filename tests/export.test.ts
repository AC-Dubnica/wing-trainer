import { describe, expect, it } from 'vitest'
import sample from '../fixtures/sample.snap.json'
import { duplicateChannel } from '../src/shared/duplicate'
import { exportSnapshot } from '../src/shared/export'
import { addBus, addMatrix, removeBus, removeMatrix, renameMix } from '../src/shared/mixes'
import { parseSnapshot } from '../src/shared/snapshot'

const raw = (): unknown => structuredClone(sample)
const load = () => { const base = parseSnapshot(raw()); return { base, cur: structuredClone(base) } }
const ae = (json: unknown): any => (json as { ae_data: unknown }).ae_data

/** The paths (inside ae_data) at which two JSON values differ. */
function diffPaths(a: any, b: any, path: string[] = []): string[] {
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return a === b ? [] : [path.join('.')]
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  return [...keys].flatMap((k) => diffPaths(a[k], b[k], [...path, k]))
}
const changed = (json: unknown): string[] => diffPaths(ae(raw()), ae(json))

describe('exportSnapshot', () => {
  it('writes an unedited snapshot back exactly as it was', () => {
    const { base, cur } = load()
    const r = exportSnapshot(raw(), base, cur)
    expect(r.json).toEqual(raw())
    expect(r.written).toEqual([])
  })

  it('does not change the original it was given', () => {
    const original = raw()
    const { base, cur } = load()
    cur.channels.find((c) => c.id === 13)!.fader = -20
    exportSnapshot(original, base, cur)
    expect(original).toEqual(raw())
  })

  it('writes only the value that was edited', () => {
    const { base, cur } = load()
    cur.channels.find((c) => c.id === 14)!.gate.attack = 33
    expect(changed(exportSnapshot(raw(), base, cur).json)).toEqual(['ch.14.gate.att'])
  })

  it('writes the values of a channel in the file\'s own names and units', () => {
    const { base, cur } = load()
    const c = cur.channels.find((x) => x.id === 13)!
    c.fader = -12.5
    c.mute = true
    c.trim = 3
    c.pan = 25
    c.filters.lowCut.freq = 120
    c.eq.on = false
    c.eq.bands[1].gain = -3.5
    c.eq.low.shelf = false
    c.comp.on = true
    c.comp.knee = 8
    c.comp.makeup = 4
    c.gate.threshold = -50
    const json = exportSnapshot(raw(), base, cur).json
    const ch = ae(json).ch['13']
    expect(ch.fdr).toBe(-12.5)
    expect(ch.mute).toBe(true)
    expect(ch.in.set.trim).toBe(3)
    expect(ch.pan).toBe(25)
    expect(ch.flt.lcf).toBe(120)
    expect(ch.eq.on).toBe(false)
    expect(ch.eq['2g']).toBe(-3.5)
    expect(ch.eq.leq).toBe('PEQ') // the word, not a flag
    expect(ch.dyn.on).toBe(true)
    expect(ch.dyn.knee).toBe(2) // 8 dB in the trainer is step 2 in the file
    expect(ch.dyn.gain).toBe(4)
    expect(ch.gate.thr).toBe(-50)
  })

  it('keeps a ratio written as text in that form', () => {
    const r = raw() as any
    r.ae_data.ch['21'] = { ...r.ae_data.ch['13'], name: 'X', dyn: { ...r.ae_data.ch['13'].dyn, mdl: 'COMP', ratio: '4:1' } }
    const base = parseSnapshot(r)
    const cur = structuredClone(base)
    cur.channels.find((c) => c.id === 21)!.comp.ratio = 6
    expect(ae(exportSnapshot(r, base, cur).json).ch['21'].dyn.ratio).toBe('6:1')
  })

  it('writes sends, main assignments, inputs and outputs', () => {
    const { base, cur } = load()
    const c = cur.channels.find((x) => x.id === 13)!
    const stream = cur.buses.find((b) => b.name === 'STREAM')!.id
    const send = c.sends.find((s) => s.bus === stream)!
    send.level = -9
    send.pre = true
    c.mains.find((m) => m.main === 1)!.on = false
    c.source = { grp: 'C', in: 5 }
    cur.outputs.find((o) => o.grp === 'C' && o.port === 7)!.source = { grp: 'MAIN', in: 2 }
    cur.outputs.push({ grp: 'AUX', port: 5, source: { grp: 'BUS', in: 4 } })
    cur.outputs = cur.outputs.filter((o) => !(o.grp === 'AUX' && o.port === 2))
    const a = ae(exportSnapshot(raw(), base, cur).json)
    expect(a.ch['13'].send[String(stream)]).toMatchObject({ lvl: -9, mode: 'PRE' })
    expect(a.ch['13'].main['1'].on).toBe(false)
    expect(a.ch['13'].in.conn).toMatchObject({ grp: 'C', in: 5 })
    expect(a.io.out.C['7']).toMatchObject({ grp: 'MAIN', in: 2 })
    expect(a.io.out.AUX['5']).toMatchObject({ grp: 'BUS', in: 4 })
    expect(a.io.out.AUX['2']).toMatchObject({ grp: 'OFF' })
  })

  it('reads back as what was edited: the exported file, read again, is the edited snapshot', () => {
    const { base, cur } = load()
    const c = cur.channels.find((x) => x.id === 13)!
    c.fader = -7.5
    c.gate.attack = 25
    c.eq.bands[2].freq = 1234
    c.comp.knee = 12
    c.sends[0].level = -20
    c.source = { grp: 'C', in: 5 }
    cur.buses.find((b) => b.id === 4)!.fader = -2
    cur.mains[0].fader = 3
    cur.matrices[0].mute = true
    cur.outputs.find((o) => o.grp === 'USB' && o.port === 3)!.source = { grp: 'C', in: 9 }
    const again = parseSnapshot(exportSnapshot(raw(), base, cur).json)
    expect(again).toEqual(cur)
  })
})

describe('exportSnapshot of copies, buses and matrices', () => {
  it('writes a copied channel as the original\'s strip with the new name and input', () => {
    const { base, cur } = load()
    const r = duplicateChannel(cur, 13, { grp: 'C', in: 17 }, 'SINGER 6')
    if (!r.ok) throw new Error(r.reason)
    r.channel.gate.attack = 40
    const json = exportSnapshot(raw(), base, cur).json
    const original = ae(raw()).ch['13']
    const copy = ae(json).ch[String(r.channel.id)]
    expect(copy.name).toBe('SINGER 6')
    expect(copy.in.conn).toMatchObject({ grp: 'C', in: 17 })
    expect(copy.gate.att).toBe(40)
    expect(copy.eq).toEqual(original.eq) // everything else is the original's
    expect(copy.send).toEqual(original.send)
    expect(ae(json).ch['13']).toEqual(original) // the original is not touched
    const again = parseSnapshot(json)
    expect(again.channels.find((c) => c.id === r.channel.id)).toMatchObject({ name: 'SINGER 6', source: { grp: 'C', in: 17 }, hasSource: true })
  })

  it('writes a new bus into its slot with every send to it off', () => {
    const { base, cur } = load()
    const b = addBus(cur, 'MON NEW')!
    cur.channels.find((c) => c.id === 13)!.sends.find((s) => s.bus === b.id)!.on = true
    cur.channels.find((c) => c.id === 13)!.sends.find((s) => s.bus === b.id)!.level = -6
    const json = exportSnapshot(raw(), base, cur).json
    const a = ae(json)
    expect(a.bus[String(b.id)].name).toBe('MON NEW')
    expect(a.bus[String(b.id)].main['1'].on).toBe(false)
    expect(a.ch['13'].send[String(b.id)]).toMatchObject({ on: true, lvl: -6 })
    expect(a.ch['14'].send[String(b.id)]).toMatchObject({ on: false })
    const again = parseSnapshot(json)
    expect(again.buses.find((x) => x.id === b.id)?.name).toBe('MON NEW')
  })

  it('writes a removed bus as an empty slot, its sends off and its outputs unpatched', () => {
    const { base, cur } = load()
    removeBus(cur, 4)
    const json = exportSnapshot(raw(), base, cur).json
    const a = ae(json)
    expect(a.bus['4'].name).toBe('')
    expect(a.ch['13'].send['4'].on).toBe(false)
    const again = parseSnapshot(json)
    expect(again.buses.some((b) => b.id === 4)).toBe(false)
    expect(again.outputs.some((o) => o.source.grp === 'BUS' && o.source.in === 4)).toBe(false)
  })

  it('writes a renamed bus, a new matrix and a removed matrix', () => {
    const { base, cur } = load()
    renameMix(cur, 'bus', 4, 'WEB STREAM')
    const m = addMatrix(cur, 'LOBBY')!
    removeMatrix(cur, 1)
    const json = exportSnapshot(raw(), base, cur).json
    const again = parseSnapshot(json)
    expect(again.buses.find((b) => b.id === 4)?.name).toBe('WEB STREAM')
    expect(again.matrices.map((x) => x.name)).toEqual(['LOBBY'])
    expect(m.id).toBe(2)
  })

  it('refuses a file that is not a snapshot', () => {
    const { base, cur } = load()
    expect(() => exportSnapshot({ hello: 1 }, base, cur)).toThrow(/not a WING snapshot/)
  })
})
