import { OFF_DB, type Channel, type Snapshot } from './model'

export interface Finding {
  /** The channel it is about. */
  channel: number
  severity: 'warn' | 'note'
  /** A stable name for the kind of finding, for tests and for the lessons that check it. */
  kind: 'gate-attack' | 'no-makeup' | 'fader-high' | 'fader-low' | 'goes-nowhere' | 'sends-while-muted'
  text: string
}

/** A gate that opens faster than this clicks on a voice. */
export const MIN_GATE_ATTACK_MS = 5

const label = (c: Channel): string => `Ch ${c.id} ${c.name || '(no name)'}`

/** The usual trouble spots of a setup, found from the settings alone (the same ones the written analysis of the Sunday setup lists). */
export function checkChannel(c: Channel): Finding[] {
  const out: Finding[] = []
  const add = (severity: Finding['severity'], kind: Finding['kind'], text: string) => out.push({ channel: c.id, severity, kind, text: `${label(c)}: ${text}` })
  if (c.gate.on && c.gate.attack < MIN_GATE_ATTACK_MS) add('warn', 'gate-attack', `the gate attack is ${c.gate.attack} ms, which can click. Use at least ${MIN_GATE_ATTACK_MS} ms (10 ms for voices).`)
  if (c.comp.on && c.comp.model === 'COMP' && c.comp.makeup === 0 && c.comp.ratio >= 2) add('note', 'no-makeup', 'the compressor has no make-up gain, so the channel gets quieter when it works.')
  if (c.hasSource && !c.mute && c.fader > 5) add('warn', 'fader-high', `the fader is at ${c.fader.toFixed(1)} dB: raise the gain at the source instead.`)
  if (c.hasSource && !c.mute && c.fader > OFF_DB && c.fader < -30) add('note', 'fader-low', `the fader is down at ${c.fader.toFixed(1)} dB: lower the gain at the source's other end, or is it meant to be nearly off?`)
  const toMain = c.mains.some((m) => m.on)
  const toBus = c.sends.some((s) => s.on && s.level > OFF_DB)
  if (c.hasSource && !c.mute && c.fader > OFF_DB && !toMain && !toBus) add('warn', 'goes-nowhere', 'it is not sent to any main or bus, so nobody hears it.')
  if (c.mute && c.sends.some((s) => s.on && s.pre)) add('note', 'sends-while-muted', 'it is muted but has pre-fader sends switched on.')
  return out
}

export function checkSnapshot(s: Snapshot): Finding[] {
  return s.channels.flatMap(checkChannel).sort((a, b) => (a.severity === b.severity ? a.channel - b.channel : a.severity === 'warn' ? -1 : 1))
}
