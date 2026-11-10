import type { Bus, Channel, Main, Matrix, Snapshot } from './model'

/** A path inside the snapshot's `ae_data`, like ["ch", 13, "gate", "att"]. */
type Path = (string | number)[]

export interface ExportResult {
  /** The snapshot file's content with the changes written in (the original is not touched). */
  json: unknown
  /** What was written, as paths such as `ch.13.gate.att`, for the report. */
  written: string[]
}

const round = (v: number): number => Math.round(v * 1e4) / 1e4
const same = (a: unknown, b: unknown): boolean => (typeof a === 'object' && a !== null ? JSON.stringify(a) === JSON.stringify(b) : a === b)

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Writes what was edited in the trainer back into the snapshot file it was read from. The original JSON is kept as it is and only the
 * values that differ between `base` (the snapshot as it was loaded) and `cur` (as it is now) are written, so everything the trainer does
 * not know about (effects, DCA groups, layers, the preamps ...) stays exactly as the console saved it.
 *
 * What it writes: channels (name, input, trim, fader, mute, pan, filters, EQ, gate, compressor, sends, main assignments), channels copied
 * in the trainer, buses and matrices (added, renamed, removed, fader, mute, assignments, sends), mains (fader, mute), and the output patch.
 * It does not write the order of the faders (the console's layers).
 */
export function exportSnapshot(raw: unknown, base: Snapshot, cur: Snapshot): ExportResult {
  const out = structuredClone(raw) as Obj
  if (!isObj(out.ae_data)) throw new Error('This file has no ae_data: it is not a WING snapshot.')
  const ae = out.ae_data as Obj
  const written: string[] = []

  const at = (path: Path, create: boolean): Obj | null => {
    let node: Obj = ae
    for (const key of path) {
      const next = node[String(key)]
      if (isObj(next)) node = next
      else if (create) { const made: Obj = {}; node[String(key)] = made; node = made }
      else return null
    }
    return node
  }
  /** Sets one value, making the objects on the way if they are not there. */
  const put = (path: Path, value: unknown): void => {
    const parent = at(path.slice(0, -1), true)!
    const v = typeof value === 'number' ? round(value) : value
    if (same(parent[String(path[path.length - 1])], v)) return
    parent[String(path[path.length - 1])] = v
    written.push(path.join('.'))
  }
  /** Writes `value` when it differs from what it was at load time (or always, when `force`). */
  const set = (path: Path, was: unknown, value: unknown, force = false): void => { if (force || !same(was, value)) put(path, value) }

  // ---- channels
  const channelFields = (id: number, a: Channel, b: Channel, force: boolean): void => {
    const p = (...rest: (string | number)[]): Path => ['ch', id, ...rest]
    set(p('name'), a.name, b.name, force)
    set(p('mute'), a.mute, b.mute, force)
    set(p('fdr'), a.fader, b.fader, force)
    set(p('pan'), a.pan, b.pan, force)
    set(p('in', 'set', 'trim'), a.trim, b.trim, force)
    const srcA = a.hasSource ? a.source : { grp: 'OFF', in: 1 }
    const srcB = b.hasSource ? b.source : { grp: 'OFF', in: 1 }
    set(p('in', 'conn', 'grp'), srcA.grp, srcB.grp, force)
    set(p('in', 'conn', 'in'), srcA.in, srcB.in, force)
    set(p('flt', 'lc'), a.filters.lowCut.on, b.filters.lowCut.on, force)
    set(p('flt', 'lcf'), a.filters.lowCut.freq, b.filters.lowCut.freq, force)
    set(p('flt', 'hc'), a.filters.highCut.on, b.filters.highCut.on, force)
    set(p('flt', 'hcf'), a.filters.highCut.freq, b.filters.highCut.freq, force)
    // EQ: the six bands
    set(p('eq', 'on'), a.eq.on, b.eq.on, force)
    set(p('eq', 'lg'), a.eq.low.gain, b.eq.low.gain, force)
    set(p('eq', 'lf'), a.eq.low.freq, b.eq.low.freq, force)
    set(p('eq', 'lq'), a.eq.low.q, b.eq.low.q, force)
    if (force || a.eq.low.shelf !== b.eq.low.shelf) put(p('eq', 'leq'), b.eq.low.shelf ? 'SHV' : 'PEQ') // booleans here, words in the file
    set(p('eq', 'hg'), a.eq.high.gain, b.eq.high.gain, force)
    set(p('eq', 'hf'), a.eq.high.freq, b.eq.high.freq, force)
    set(p('eq', 'hq'), a.eq.high.q, b.eq.high.q, force)
    if (force || a.eq.high.shelf !== b.eq.high.shelf) put(p('eq', 'heq'), b.eq.high.shelf ? 'SHV' : 'PEQ')
    b.eq.bands.forEach((band, i) => {
      set(p('eq', `${i + 1}g`), a.eq.bands[i].gain, band.gain, force)
      set(p('eq', `${i + 1}f`), a.eq.bands[i].freq, band.freq, force)
      set(p('eq', `${i + 1}q`), a.eq.bands[i].q, band.q, force)
    })
    set(p('gate', 'on'), a.gate.on, b.gate.on, force)
    set(p('gate', 'thr'), a.gate.threshold, b.gate.threshold, force)
    set(p('gate', 'range'), a.gate.range, b.gate.range, force)
    set(p('gate', 'att'), a.gate.attack, b.gate.attack, force)
    set(p('gate', 'hld'), a.gate.hold, b.gate.hold, force)
    set(p('gate', 'rel'), a.gate.release, b.gate.release, force)
    set(p('dyn', 'on'), a.comp.on, b.comp.on, force)
    if (b.comp.model === 'COMP') {
      set(p('dyn', 'thr'), a.comp.threshold, b.comp.threshold, force)
      // The ratio is a number, or text like "4:1" in some files: keep the form the file uses.
      if (force || a.comp.ratio !== b.comp.ratio) {
        const was = at(p('dyn'), false)?.ratio
        put(p('dyn', 'ratio'), typeof was === 'string' ? `${round(b.comp.ratio)}:1` : b.comp.ratio)
      }
      // The knee is 0 to 5 in the file and in dB (4 per step) in the trainer.
      if (force || a.comp.knee !== b.comp.knee) put(p('dyn', 'knee'), Math.min(5, Math.max(0, Math.round(b.comp.knee / 4))))
      set(p('dyn', 'att'), a.comp.attack, b.comp.attack, force)
      set(p('dyn', 'rel'), a.comp.release, b.comp.release, force)
      set(p('dyn', 'gain'), a.comp.makeup, b.comp.makeup, force)
    }
    for (const s of b.sends) {
      const was = a.sends.find((x) => x.bus === s.bus)
      set(p('send', s.bus, 'on'), was?.on, s.on, force || !was)
      set(p('send', s.bus, 'lvl'), was?.level, s.level, force || !was)
      if (force || !was || was.pre !== s.pre) put(p('send', s.bus, 'mode'), s.pre ? 'PRE' : 'POST')
    }
    for (const m of b.mains) {
      const was = a.mains.find((x) => x.main === m.main)
      set(p('main', m.main, 'on'), was?.on, m.on, force || !was)
      set(p('main', m.main, 'lvl'), was?.level, m.level, force || !was)
    }
  }

  for (const c of cur.channels) {
    const was = base.channels.find((x) => x.id === c.id)
    if (was) { channelFields(c.id, was, c, false); continue }
    // A channel made in the trainer by copying another: its slot gets the original's whole strip, then what differs.
    const from = c.copyOf ? base.channels.find((x) => x.id === c.copyOf) : undefined
    const template = c.copyOf ? at(['ch', c.copyOf], false) : null
    if (!from || !template) continue
    ;(ae.ch as Obj)[String(c.id)] = structuredClone(template)
    written.push(`ch.${c.id}`)
    channelFields(c.id, from, c, false)
  }

  // ---- buses and matrices
  const busFields = (a: Bus | null, b: Bus): void => {
    const p = (...rest: (string | number)[]): Path => ['bus', b.id, ...rest]
    set(p('name'), a?.name, b.name, !a)
    set(p('mute'), a?.mute, b.mute, !a)
    set(p('fdr'), a?.fader, b.fader, !a)
    for (const m of b.mains) {
      const was = a?.mains.find((x) => x.main === m.main)
      set(p('main', m.main, 'on'), was?.on, m.on, !was)
      set(p('main', m.main, 'lvl'), was?.level, m.level, !was)
    }
    for (const x of b.matrix) {
      const was = a?.matrix.find((y) => y.mtx === x.mtx)
      set(p('send', `MX${x.mtx}`, 'on'), was?.on, x.on, !was)
      set(p('send', `MX${x.mtx}`, 'lvl'), was?.level, x.level, !was)
    }
  }
  for (const b of cur.buses) busFields(base.buses.find((x) => x.id === b.id) ?? null, b)
  for (const b of base.buses) {
    if (cur.buses.some((x) => x.id === b.id)) continue
    // A bus that was removed goes back to an empty slot: no name, assigned to nothing.
    put(['bus', b.id, 'name'], '')
    for (const m of b.mains) put(['bus', b.id, 'main', m.main, 'on'], false)
    for (const x of b.matrix) put(['bus', b.id, 'send', `MX${x.mtx}`, 'on'], false)
  }

  const matrixFields = (a: Matrix | null, b: Matrix): void => {
    set(['mtx', b.id, 'name'], a?.name, b.name, !a)
    set(['mtx', b.id, 'mute'], a?.mute, b.mute, !a)
    set(['mtx', b.id, 'fdr'], a?.fader, b.fader, !a)
  }
  for (const m of cur.matrices) matrixFields(base.matrices.find((x) => x.id === m.id) ?? null, m)
  for (const m of base.matrices) if (!cur.matrices.some((x) => x.id === m.id)) put(['mtx', m.id, 'name'], '')

  const mainFields = (a: Main, b: Main): void => {
    set(['main', b.id, 'name'], a.name, b.name)
    set(['main', b.id, 'mute'], a.mute, b.mute)
    set(['main', b.id, 'fdr'], a.fader, b.fader)
    for (const x of b.matrix) {
      const was = a.matrix.find((y) => y.mtx === x.mtx)
      set(['main', b.id, 'send', `MX${x.mtx}`, 'on'], was?.on, x.on, !was)
      set(['main', b.id, 'send', `MX${x.mtx}`, 'lvl'], was?.level, x.level, !was)
    }
  }
  for (const m of cur.mains) { const was = base.mains.find((x) => x.id === m.id); if (was) mainFields(was, m) }

  // ---- the output patch: an output that was patched and now is not goes back to OFF
  const key = (grp: string, port: number): string => `${grp}:${port}`
  const was = new Map(base.outputs.map((o) => [key(o.grp, o.port), o]))
  const now = new Map(cur.outputs.map((o) => [key(o.grp, o.port), o]))
  for (const [k, o] of now) {
    const w = was.get(k)
    if (!w || w.source.grp !== o.source.grp || w.source.in !== o.source.in) { put(['io', 'out', o.grp, o.port, 'grp'], o.source.grp); put(['io', 'out', o.grp, o.port, 'in'], o.source.in) }
  }
  for (const [k, o] of was) if (!now.has(k)) { put(['io', 'out', o.grp, o.port, 'grp'], 'OFF'); put(['io', 'out', o.grp, o.port, 'in'], 1) }

  return { json: out, written }
}
