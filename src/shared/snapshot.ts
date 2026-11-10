import { OFF_DB, type Bus, type Channel, type Comp, type Eq, type EqBand, type Gate, type InputPort, type MainSend, type Main, type Matrix, type MatrixSend, type OutputPatch, type Send, type Snapshot, type Source } from './model'

type Json = Record<string, unknown>

const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {})
const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
const bool = (v: unknown, fallback = false): boolean => (typeof v === 'boolean' ? v : fallback)
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)
/** The entries of a numbered object ({"1": ..., "2": ...}) as [number, value], in order. */
const numbered = (v: unknown): [number, Json][] => Object.entries(obj(v)).map(([k, x]) => [Number(k), obj(x)] as [number, Json]).filter(([k]) => Number.isInteger(k)).sort((a, b) => a[0] - b[0])

/** "1:3" or "4:1" or 3 as the ratio's larger number. */
export function parseRatio(v: unknown, fallback = 3): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const m = /^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/.exec(v.trim())
    if (m) return Math.max(Number(m[1]), Number(m[2]))
  }
  return fallback
}

const band = (e: Json, i: number): EqBand => ({ gain: num(e[`${i}g`], 0), freq: num(e[`${i}f`], 1000), q: num(e[`${i}q`], 1) })

function parseEq(raw: unknown): Eq {
  const e = obj(raw)
  return {
    on: bool(e.on),
    low: { gain: num(e.lg, 0), freq: num(e.lf, 80), q: num(e.lq, 1), shelf: str(e.leq, 'SHV') !== 'PEQ' },
    bands: [band(e, 1), band(e, 2), band(e, 3), band(e, 4)],
    high: { gain: num(e.hg, 0), freq: num(e.hf, 10000), q: num(e.hq, 1), shelf: str(e.heq, 'SHV') !== 'PEQ' },
  }
}

function parseGate(raw: unknown): Gate {
  const g = obj(raw)
  return { on: bool(g.on), threshold: num(g.thr, -60), range: num(g.range, 30), attack: num(g.att, 5), hold: num(g.hld, 50), release: num(g.rel, 200) }
}

function parseComp(raw: unknown): Comp {
  const d = obj(raw)
  return {
    on: bool(d.on),
    model: str(d.mdl, 'COMP'),
    threshold: num(d.thr, -20),
    ratio: parseRatio(d.ratio, 3),
    knee: num(d.knee, 2) * 4,
    attack: num(d.att, 20),
    release: num(d.rel, 200),
    makeup: num(d.gain, 0),
  }
}

const mainSends = (raw: unknown): MainSend[] => numbered(raw).map(([main, m]) => ({ main, on: bool(m.on), level: num(m.lvl, 0) }))

function parseChannel(id: number, c: Json): Channel {
  const conn = obj(obj(obj(c.in).conn))
  const source: Source = { grp: str(conn.grp, 'OFF'), in: num(conn.in, 1) }
  const flt = obj(c.flt)
  return {
    id,
    name: str(c.name),
    color: num(c.col, 0),
    source,
    hasSource: source.grp !== 'OFF',
    trim: num(obj(obj(c.in).set).trim, 0),
    mute: bool(c.mute),
    fader: num(c.fdr, OFF_DB),
    pan: num(c.pan, 0),
    filters: { lowCut: { on: bool(flt.lc), freq: num(flt.lcf, 80) }, highCut: { on: bool(flt.hc), freq: num(flt.hcf, 12000) } },
    eq: parseEq(c.eq),
    gate: parseGate(c.gate),
    comp: parseComp(c.dyn),
    sends: numbered(c.send).map(([bus, s]): Send => ({ bus, on: bool(s.on), level: num(s.lvl, -144), pre: str(s.mode, 'POST') === 'PRE' })),
    mains: mainSends(c.main),
  }
}

/** A bus's sends to the matrices are keyed "MX1", "MX2" ... */
const matrixSends = (raw: unknown): MatrixSend[] =>
  Object.entries(obj(raw))
    .map(([k, s]) => ({ m: /^MX(\d+)$/.exec(k), s: obj(s) }))
    .filter((x) => x.m !== null)
    .map((x): MatrixSend => ({ mtx: Number(x.m![1]), on: bool(x.s.on), level: num(x.s.lvl, -144) }))
    .sort((a, b) => a.mtx - b.mtx)

function parseBus(id: number, b: Json): Bus {
  return {
    id,
    name: str(b.name),
    mute: bool(b.mute),
    fader: num(b.fdr, 0),
    mains: mainSends(b.main),
    matrix: matrixSends(b.send),
  }
}

/**
 * A snapshot model saved by an older version of the app (the work state that is remembered between runs) lacks what later versions
 * added: it is filled in with neutral values so that everything that reads the model can rely on it. Returns the same object.
 */
export function ensureModel(s: Snapshot): Snapshot {
  s.inputs ??= []
  s.outputs ??= []
  s.matrices ??= []
  for (const m of s.mains) m.matrix ??= []
  for (const b of s.buses) { b.matrix ??= []; b.mains ??= [] }
  for (const c of s.channels) { c.sends ??= []; c.mains ??= [] }
  return s
}

/**
 * Reads a snapshot file saved by a Behringer WING (JSON). Anything missing falls back to a neutral value, so a snapshot from
 * another firmware still opens. Throws only when the file is not a snapshot at all.
 */
export function parseSnapshot(raw: unknown): Snapshot {
  const root = obj(raw)
  const ae = obj(root.ae_data)
  if (!Object.keys(ae).length || !Object.keys(obj(ae.ch)).length) throw new Error('This is not a WING snapshot: it has no channels.')
  // A channel that has neither a name nor an input is an unused strip.
  const channels = numbered(ae.ch).map(([id, c]) => parseChannel(id, c)).filter((c) => c.name !== '' || c.hasSource)
  const buses = numbered(ae.bus).map(([id, b]) => parseBus(id, b)).filter((b) => b.name !== '')
  const mains: Main[] = numbered(ae.main).map(([id, m]) => ({ id, name: str(m.name) || `MAIN ${id}`, mute: bool(m.mute), fader: num(m.fdr, 0), matrix: matrixSends(m.send) })).filter((m) => m.id <= 2 || m.name !== `MAIN ${m.id}`)
  const matrices: Matrix[] = numbered(ae.mtx).map(([id, m]) => ({ id, name: str(m.name), mute: bool(m.mute), fader: num(m.fdr, 0) })).filter((m) => m.name !== '')
  const io = obj(ae.io)
  const inputs: InputPort[] = Object.entries(obj(io.in)).flatMap(([grp, ports]) =>
    numbered(ports).map(([port, p]): InputPort => ({ grp, port, name: str(p.name), gain: num(p.g, 0), phantom: bool(p.vph) })).filter((x) => x.name !== ''))
  const outputs: OutputPatch[] = Object.entries(obj(io.out)).flatMap(([grp, ports]) =>
    numbered(ports).map(([port, x]): OutputPatch => ({ grp, port, source: { grp: str(x.grp, 'OFF'), in: num(x.in, 1) } })).filter((x) => x.source.grp !== 'OFF' && x.source.grp !== ''))
  return { created: str(root.created), firmware: str(root.creator_fw), channels, buses, mains, matrices, inputs, outputs }
}
