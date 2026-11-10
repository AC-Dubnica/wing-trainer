import { OFF_DB, type Bus, type Channel, type Main, type Snapshot } from './model'

export interface Change {
  /** "Ch 13 SINGER 1", "Bus 4 STREAM". */
  where: string
  /** "Gate attack". */
  what: string
  from: string
  to: string
}

const db = (v: number): string => (v <= OFF_DB ? 'off' : `${v.toFixed(1)} dB`)
const ms = (v: number): string => `${Number(v.toFixed(1))} ms`
const hz = (v: number): string => (v >= 1000 ? `${Number((v / 1000).toFixed(2))} kHz` : `${Math.round(v)} Hz`)
const onoff = (v: boolean): string => (v ? 'on' : 'off')
const plain = (v: number): string => String(Number(v.toFixed(2)))

type Values = Record<string, string>

function channelValues(c: Channel): Values {
  const v: Values = {
    Input: c.hasSource ? `${c.source.grp} ${c.source.in}` : 'none', Fader: db(c.fader), Mute: onoff(c.mute), Trim: db(c.trim), Pan: plain(c.pan),
    'Low cut': `${onoff(c.filters.lowCut.on)} ${hz(c.filters.lowCut.freq)}`,
    'High cut': `${onoff(c.filters.highCut.on)} ${hz(c.filters.highCut.freq)}`,
    EQ: onoff(c.eq.on),
    'EQ low': `${db(c.eq.low.gain)} at ${hz(c.eq.low.freq)}, Q ${plain(c.eq.low.q)}`,
    'EQ high': `${db(c.eq.high.gain)} at ${hz(c.eq.high.freq)}, Q ${plain(c.eq.high.q)}`,
    Gate: onoff(c.gate.on), 'Gate threshold': db(c.gate.threshold), 'Gate range': db(c.gate.range), 'Gate attack': ms(c.gate.attack), 'Gate hold': ms(c.gate.hold), 'Gate release': ms(c.gate.release),
    Compressor: onoff(c.comp.on), 'Compressor threshold': db(c.comp.threshold), 'Compressor ratio': `${plain(c.comp.ratio)}:1`, 'Compressor attack': ms(c.comp.attack), 'Compressor release': ms(c.comp.release), 'Compressor make-up': db(c.comp.makeup),
  }
  c.eq.bands.forEach((b, i) => { v[`EQ band ${i + 1}`] = `${db(b.gain)} at ${hz(b.freq)}, Q ${plain(b.q)}` })
  for (const s of c.sends) v[`Send to bus ${s.bus}`] = `${onoff(s.on)} ${db(s.level)} ${s.pre ? 'pre' : 'post'}`
  for (const m of c.mains) v[`To main ${m.main}`] = `${onoff(m.on)} ${db(m.level)}`
  return v
}

const busValues = (b: Bus): Values => ({ Fader: db(b.fader), Mute: onoff(b.mute), ...Object.fromEntries(b.mains.map((m) => [`To main ${m.main}`, `${onoff(m.on)} ${db(m.level)}`])) })
const mainValues = (m: Main): Values => ({ Fader: db(m.fader), Mute: onoff(m.mute) })

function compare(where: string, a: Values, b: Values): Change[] {
  return Object.keys(b).filter((k) => a[k] !== undefined && a[k] !== b[k]).map((k) => ({ where, what: k, from: a[k], to: b[k] }))
}

/** What was changed from `base` to `now`, one line per value, in console order. Both must come from the same snapshot. */
export function diffSnapshots(base: Snapshot, now: Snapshot): Change[] {
  const out: Change[] = []
  for (const c of now.channels) {
    const was = base.channels.find((x) => x.id === c.id)
    if (!was) {
      out.push({ where: `Ch ${c.id} ${c.name}`.trim(), what: 'Added', from: '-', to: `${c.copyOf ? `copy of Ch ${c.copyOf}, ` : ''}input ${c.hasSource ? `${c.source.grp} ${c.source.in}` : 'none'}` })
      continue
    }
    if (was) out.push(...compare(`Ch ${c.id} ${c.name}`.trim(), channelValues(was), channelValues(c)))
  }
  for (const b of now.buses) {
    const was = base.buses.find((x) => x.id === b.id)
    if (was) out.push(...compare(`Bus ${b.id} ${b.name}`, busValues(was), busValues(b)))
  }
  for (const m of now.mains) {
    const was = base.mains.find((x) => x.id === m.id)
    if (was) out.push(...compare(`Main ${m.id} ${m.name}`, mainValues(was), mainValues(m)))
  }
  // Output patching: every output that is patched in either snapshot.
  const patchOf = (s: Snapshot, grp: string, port: number): string => { const o = s.outputs.find((x) => x.grp === grp && x.port === port); return o ? `${o.source.grp} ${o.source.in}` : 'off' }
  const outputs = new Set([...base.outputs, ...now.outputs].map((o) => `${o.grp}:${o.port}`))
  for (const key of outputs) {
    const [grp, port] = key.split(':')
    const a = patchOf(base, grp, Number(port))
    const b = patchOf(now, grp, Number(port))
    if (a !== b) out.push({ where: `Output ${grp} ${port}`, what: 'Source', from: a, to: b })
  }
  return out
}

export const describeChange = (c: Change): string => `${c.where}: ${c.what} ${c.from} -> ${c.to}`
