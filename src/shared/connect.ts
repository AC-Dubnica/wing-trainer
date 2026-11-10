import { buildFlow } from './flow'
import { mainOfIndex, mainSides, mainSourceName } from './mains'
import { OFF_DB, type Snapshot } from './model'
import { setSource } from './snapshot'

/** What a node of the signal-flow diagram is, from its id (`in:C:2`, `ch:13`, `bus:4`, `main:1`, `matrix:1`, `out:USB:3`). */
export type Ref =
  | { kind: 'in'; grp: string; port: number }
  | { kind: 'ch' | 'bus' | 'main' | 'matrix'; id: number }
  | { kind: 'out'; grp: string; port: number }

export function parseRef(id: string): Ref | null {
  const [kind, a, b] = id.split(':')
  if (kind === 'in' || kind === 'out') return a && Number.isInteger(Number(b)) ? { kind, grp: a, port: Number(b) } : null
  if ((kind === 'ch' || kind === 'bus' || kind === 'main' || kind === 'matrix') && Number.isInteger(Number(a))) return { kind, id: Number(a) }
  return null
}

export interface ConnectResult { ok: boolean; message: string }

/** The level a connection starts at when it is made (a send or a bus to a matrix): unity, to be turned down by hand. */
const START_LEVEL = 0

const RANK: Record<Ref['kind'], number> = { in: 0, ch: 1, bus: 2, main: 3, matrix: 3, out: 4 }

export function nameOf(s: Snapshot, r: Ref): string {
  if (r.kind === 'in') return `${r.grp} ${r.port}${s.inputs.find((p) => p.grp === r.grp && p.port === r.port)?.name ? ` (${s.inputs.find((p) => p.grp === r.grp && p.port === r.port)!.name})` : ''}`
  if (r.kind === 'out') return `output ${r.grp} ${r.port}`
  if (r.kind === 'ch') return s.channels.find((c) => c.id === r.id)?.name || `channel ${r.id}`
  if (r.kind === 'bus') return s.buses.find((b) => b.id === r.id)?.name || `bus ${r.id}`
  if (r.kind === 'main') return s.mains.find((m) => m.id === r.id)?.name || `main ${r.id}`
  return s.matrices.find((m) => m.id === r.id)?.name || `matrix ${r.id}`
}

/** The two refs in signal order (the one that feeds first), or null when the pair is the same kind. */
function ordered(a: Ref, b: Ref): [Ref, Ref] | null {
  // A main feeds a matrix (they share a rank in the diagram's columns, but the signal goes from the main).
  if (a.kind === 'main' && b.kind === 'matrix') return [a, b]
  if (a.kind === 'matrix' && b.kind === 'main') return [b, a]
  if (RANK[a.kind] === RANK[b.kind]) return null
  return RANK[a.kind] < RANK[b.kind] ? [a, b] : [b, a]
}

const mixGroup = (r: Ref): string => (r.kind === 'main' ? 'MAIN' : r.kind === 'matrix' ? 'MTX' : 'BUS')

/**
 * Connects two things of the signal flow, whichever you name first: an input port to a channel (the channel listens to it), a channel
 * or a bus to a main, a channel to a bus (a send), a bus to a matrix, a main, bus or matrix to an output port (the output carries it),
 * or an input port straight to an output port (the recorder tracks). The snapshot is changed in place.
 */
export function connect(s: Snapshot, aId: string, bId: string): ConnectResult {
  const a = parseRef(aId), b = parseRef(bId)
  if (!a || !b) return { ok: false, message: 'That is not something that can be connected.' }
  const pair = ordered(a, b)
  if (!pair) return { ok: false, message: `${nameOf(s, a)} and ${nameOf(s, b)} are of the same kind: connect a source to something it feeds.` }
  const [from, to] = pair
  const f = nameOf(s, from), t = nameOf(s, to)

  if (from.kind === 'in' && to.kind === 'ch') {
    const c = s.channels.find((x) => x.id === to.id)
    if (!c) return { ok: false, message: 'That channel does not exist.' }
    if (c.hasSource && c.source.grp === from.grp && c.source.in === from.port) return { ok: false, message: `${t} already takes ${f}.` }
    setSource(s, c, { grp: from.grp, in: from.port })
    return { ok: true, message: `${t} now takes ${f}.` }
  }
  if (from.kind === 'ch' && to.kind === 'main') {
    const c = s.channels.find((x) => x.id === from.id)
    if (!c) return { ok: false, message: 'That channel does not exist.' }
    let m = c.mains.find((x) => x.main === to.id)
    if (m?.on) return { ok: false, message: `${f} already goes to ${t}.` }
    if (!m) { m = { main: to.id, on: false, level: 0 }; c.mains.push(m) }
    m.on = true
    if (m.level <= OFF_DB) m.level = START_LEVEL
    return { ok: true, message: `${f} now goes to ${t}.` }
  }
  if (from.kind === 'ch' && to.kind === 'bus') {
    const c = s.channels.find((x) => x.id === from.id)
    if (!c) return { ok: false, message: 'That channel does not exist.' }
    let x = c.sends.find((y) => y.bus === to.id)
    if (x?.on && x.level > OFF_DB) return { ok: false, message: `${f} already sends to ${t}.` }
    if (!x) { x = { bus: to.id, on: false, level: -144, pre: false }; c.sends.push(x); c.sends.sort((p, q) => p.bus - q.bus) }
    x.on = true
    if (x.level <= OFF_DB) x.level = START_LEVEL
    return { ok: true, message: `${f} now sends to ${t} at ${x.level} dB (turn it down with its knob in the channel's Sends).` }
  }
  if (from.kind === 'bus' && to.kind === 'main') {
    const bus = s.buses.find((x) => x.id === from.id)
    if (!bus) return { ok: false, message: 'That bus does not exist.' }
    let m = bus.mains.find((x) => x.main === to.id)
    if (m?.on) return { ok: false, message: `${f} already goes to ${t}.` }
    if (!m) { m = { main: to.id, on: false, level: 0 }; bus.mains.push(m) }
    m.on = true
    if (m.level <= OFF_DB) m.level = START_LEVEL
    return { ok: true, message: `${f} now goes to ${t}.` }
  }
  if ((from.kind === 'bus' || from.kind === 'main') && to.kind === 'matrix') {
    const item = from.kind === 'bus' ? s.buses.find((x) => x.id === from.id) : s.mains.find((x) => x.id === from.id)
    if (!item) return { ok: false, message: `That ${from.kind} does not exist.` }
    let x = item.matrix.find((y) => y.mtx === to.id)
    if (x?.on && x.level > OFF_DB) return { ok: false, message: `${f} already sends to ${t}.` }
    if (!x) { x = { mtx: to.id, on: false, level: -144 }; item.matrix.push(x); item.matrix.sort((p, q) => p.mtx - q.mtx) }
    x.on = true
    if (x.level <= OFF_DB) x.level = START_LEVEL
    return { ok: true, message: `${f} now sends to ${t}.` }
  }
  if (to.kind === 'out' && (from.kind === 'main' || from.kind === 'matrix' || from.kind === 'bus' || from.kind === 'in')) {
    // A main is a left and a right: an odd output port gets its left side and an even port its right side (connect it again to another port for the other side).
    const source = from.kind === 'in' ? { grp: from.grp, in: from.port } : from.kind === 'main' ? { grp: 'MAIN', in: mainIndexFor(s, from.id, to.port) } : { grp: mixGroup(from), in: from.id }
    const o = s.outputs.find((x) => x.grp === to.grp && x.port === to.port)
    if (o && (from.kind === 'main' ? isMainSource(s, o.source, from.id) : o.source.grp === source.grp && o.source.in === source.in)) return { ok: false, message: `${t} already carries ${describeSource(s, o.source)}.` }
    if (o) o.source = source
    else s.outputs.push({ grp: to.grp, port: to.port, source })
    return { ok: true, message: `${t} now carries ${describeSource(s, source)}.` }
  }
  return { ok: false, message: `${f} cannot feed ${t} directly. A channel reaches an output through a main, a bus or a matrix.` }
}

/** The opposite: takes the connection between two things away (what they are connected through is left alone). */
export function disconnect(s: Snapshot, aId: string, bId: string): ConnectResult {
  const a = parseRef(aId), b = parseRef(bId)
  if (!a || !b) return { ok: false, message: 'That is not something that can be disconnected.' }
  const pair = ordered(a, b)
  if (!pair) return { ok: false, message: 'Those two are not connected to each other.' }
  const [from, to] = pair
  const f = nameOf(s, from), t = nameOf(s, to)
  const not = { ok: false, message: `${f} and ${t} are not connected.` }

  if (from.kind === 'in' && to.kind === 'ch') {
    const c = s.channels.find((x) => x.id === to.id)
    if (!c || !c.hasSource || c.source.grp !== from.grp || c.source.in !== from.port) return not
    setSource(s, c, null)
    return { ok: true, message: `${t} no longer takes ${f}: it has no input now.` }
  }
  if ((from.kind === 'ch' || from.kind === 'bus') && to.kind === 'main') {
    const item = from.kind === 'ch' ? s.channels.find((x) => x.id === from.id) : s.buses.find((x) => x.id === from.id)
    const m = item?.mains.find((x) => x.main === to.id)
    if (!m?.on) return not
    m.on = false
    return { ok: true, message: `${f} no longer goes to ${t}.` }
  }
  if (from.kind === 'ch' && to.kind === 'bus') {
    const x = s.channels.find((c) => c.id === from.id)?.sends.find((y) => y.bus === to.id)
    if (!x?.on || x.level <= OFF_DB) return not
    x.on = false
    return { ok: true, message: `${f} no longer sends to ${t}.` }
  }
  if ((from.kind === 'bus' || from.kind === 'main') && to.kind === 'matrix') {
    const item = from.kind === 'bus' ? s.buses.find((b) => b.id === from.id) : s.mains.find((m) => m.id === from.id)
    const x = item?.matrix.find((y) => y.mtx === to.id)
    if (!x?.on || x.level <= OFF_DB) return not
    x.on = false
    return { ok: true, message: `${f} no longer sends to ${t}.` }
  }
  if (to.kind === 'out') {
    const source = from.kind === 'in' ? { grp: from.grp, in: from.port } : { grp: mixGroup(from), in: (from as { id: number }).id }
    const i = s.outputs.findIndex((x) => x.grp === to.grp && x.port === to.port && (from.kind === 'main' ? isMainSource(s, x.source, from.id) : x.source.grp === source.grp && x.source.in === source.in))
    if (i < 0) return not
    s.outputs.splice(i, 1)
    return { ok: true, message: `${t} no longer carries ${f}: it is not patched now.` }
  }
  return not
}

/** The ref of what an output (or anything) is patched to, from a source such as `{ grp: 'BUS', in: 8 }`. */
function sourceRef(s: Snapshot, src: { grp: string; in: number }): Ref {
  // The MAIN group lists the left and right of each main (see mains.ts), so its index is not the main's number.
  if (src.grp === 'MAIN') return { kind: 'main', id: mainOfIndex(s, src.in)?.main ?? src.in }
  if (src.grp === 'MTX') return { kind: 'matrix', id: src.in }
  if (src.grp === 'BUS') return { kind: 'bus', id: src.in }
  return { kind: 'in', grp: src.grp, port: src.in }
}

/** What an output's source is, in words: "main PA (left)", "bus STREAM 2", "input C 5". */
function describeSource(s: Snapshot, src: { grp: string; in: number }): string {
  if (src.grp === 'MAIN') return `main ${mainSourceName(s, src.in)}`
  const ref = sourceRef(s, src)
  return `${ref.kind === 'in' ? 'input' : ref.kind} ${nameOf(s, ref).replace(/^(.+) \(.*\)$/, '$1')}`
}

/** The entry of the MAIN source group to patch to an output port: an odd port takes the left side and an even port the right side (as in a stereo pair of outputs). */
function mainIndexFor(s: Snapshot, main: number, port: number): number {
  const sides = mainSides(s).filter((x) => x.main === main)
  if (sides.length === 1) return sides[0].index // a mono main
  return (sides.find((x) => x.side === (port % 2 === 1 ? 'L' : 'R')) ?? sides[0])?.index ?? main
}

/** Whether an output source is this main (either of its sides). */
const isMainSource = (s: Snapshot, src: { grp: string; in: number }, main: number): boolean => src.grp === 'MAIN' && mainOfIndex(s, src.in)?.main === main

/**
 * What connecting the two would take away, in words, or null when it only adds: an output that carries something else loses that,
 * and a channel that listens to another input stops listening to it. Nothing is changed. The screen asks before going on.
 */
export function replacement(s: Snapshot, aId: string, bId: string): string | null {
  const a = parseRef(aId), b = parseRef(bId)
  if (!a || !b || isConnected(s, aId, bId)) return null
  const pair = ordered(a, b)
  if (!pair) return null
  const [from, to] = pair
  if (to.kind === 'out' && from.kind !== 'ch') {
    const o = s.outputs.find((x) => x.grp === to.grp && x.port === to.port)
    if (!o) return null
    const was = describeSource(s, o.source)
    return `${nameOf(s, to)} carries ${was} now. Connecting ${nameOf(s, from)} replaces it: ${was} will no longer go to ${nameOf(s, to)}.`
  }
  if (from.kind === 'in' && to.kind === 'ch') {
    const c = s.channels.find((x) => x.id === to.id)
    if (!c || !c.hasSource) return null
    const was = `${c.source.grp} ${c.source.in}`
    return `${nameOf(s, to)} takes input ${was} now. Connecting ${nameOf(s, from)} replaces it: ${nameOf(s, to)} will no longer listen to ${was}.`
  }
  return null
}

/** Whether two things of the flow are connected now (in either order): a line is drawn between them. */
export function isConnected(s: Snapshot, aId: string, bId: string): boolean {
  return buildFlow(s).edges.some((e) => (e.from === aId && e.to === bId) || (e.from === bId && e.to === aId))
}

export interface ToggleResult extends ConnectResult { /** True when a connection was made, false when one was taken away. */ added: boolean }

/** One gesture for both: if the two are connected the connection is removed, if not it is made. */
export function toggleConnection(s: Snapshot, aId: string, bId: string): ToggleResult {
  if (isConnected(s, aId, bId)) return { ...disconnect(s, aId, bId), added: false }
  return { ...connect(s, aId, bId), added: true }
}
