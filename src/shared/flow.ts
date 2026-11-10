import { OFF_DB, type Snapshot } from './model'

export type NodeKind = 'in' | 'ch' | 'bus' | 'main' | 'matrix' | 'out'

export interface FlowNode {
  id: string
  kind: NodeKind
  label: string
  /** A second line: the port, a level, "muted". */
  sub: string
  /** The console colour number (channels). */
  color: number
  muted: boolean
}

/** input: port to channel. main: channel or bus assigned to a main. send: channel to bus. matrix: bus to matrix. patch: a mix or input to an output port. */
export type EdgeKind = 'input' | 'main' | 'send' | 'matrix' | 'patch'

export interface FlowEdge {
  from: string
  to: string
  kind: EdgeKind
  /** "-4.5 dB post". */
  label: string
  muted: boolean
}

const dbLabel = (v: number): string => (v <= OFF_DB ? 'off' : `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`)

export const inId = (grp: string, port: number): string => `in:${grp}:${port}`
export const outId = (grp: string, port: number): string => `out:${grp}:${port}`

/**
 * The whole venue as a graph, from the snapshot: input ports -> channels -> mains, buses and matrices -> output ports.
 * Only what is used appears: a port nobody takes and an output that is not patched are left out. Sends that are off are not edges.
 */
export function buildFlow(s: Snapshot): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const nodes = new Map<string, FlowNode>()
  const edges: FlowEdge[] = []
  const add = (n: FlowNode): void => { if (!nodes.has(n.id)) nodes.set(n.id, n) }
  const portName = (grp: string, port: number): string => s.inputs.find((p) => p.grp === grp && p.port === port)?.name ?? ''
  const inputNode = (grp: string, port: number): string => {
    const id = inId(grp, port)
    add({ id, kind: 'in', label: `${grp} ${port}`, sub: portName(grp, port), color: 0, muted: false })
    return id
  }

  // Every input port that has a name in the snapshot is there, used or not, so a channel can be connected to it.
  for (const p of s.inputs) inputNode(p.grp, p.port)
  for (const m of s.mains) add({ id: `main:${m.id}`, kind: 'main', label: m.name, sub: `MAIN ${m.id} · ${dbLabel(m.fader)}`, color: 0, muted: m.mute })
  for (const m of s.matrices) add({ id: `matrix:${m.id}`, kind: 'matrix', label: m.name, sub: `MATRIX ${m.id} · ${dbLabel(m.fader)}`, color: 0, muted: m.mute })
  for (const b of s.buses) add({ id: `bus:${b.id}`, kind: 'bus', label: b.name, sub: `BUS ${b.id} · ${dbLabel(b.fader)}`, color: 0, muted: b.mute })

  for (const c of s.channels) {
    const id = `ch:${c.id}`
    add({ id, kind: 'ch', label: c.name || `Ch ${c.id}`, sub: `CH ${c.id} · ${dbLabel(c.fader)}`, color: c.color, muted: c.mute })
    if (c.hasSource) edges.push({ from: inputNode(c.source.grp, c.source.in), to: id, kind: 'input', label: '', muted: c.mute })
    for (const m of c.mains) if (m.on && nodes.has(`main:${m.main}`)) edges.push({ from: id, to: `main:${m.main}`, kind: 'main', label: dbLabel(m.level), muted: c.mute })
    for (const x of c.sends) if (x.on && x.level > OFF_DB && nodes.has(`bus:${x.bus}`)) edges.push({ from: id, to: `bus:${x.bus}`, kind: 'send', label: `${dbLabel(x.level)} ${x.pre ? 'pre' : 'post'}`, muted: c.mute })
  }
  for (const b of s.buses) {
    for (const m of b.mains) if (m.on && nodes.has(`main:${m.main}`)) edges.push({ from: `bus:${b.id}`, to: `main:${m.main}`, kind: 'main', label: dbLabel(m.level), muted: b.mute })
    for (const x of b.matrix) if (x.on && x.level > OFF_DB && nodes.has(`matrix:${x.mtx}`)) edges.push({ from: `bus:${b.id}`, to: `matrix:${x.mtx}`, kind: 'matrix', label: dbLabel(x.level), muted: b.mute })
  }

  for (const m of s.mains) {
    for (const x of m.matrix) if (x.on && x.level > OFF_DB && nodes.has(`matrix:${x.mtx}`)) edges.push({ from: `main:${m.id}`, to: `matrix:${x.mtx}`, kind: 'matrix', label: dbLabel(x.level), muted: m.mute })
  }

  for (const o of s.outputs) {
    const id = outId(o.grp, o.port)
    const label = `${o.grp} ${o.port}`
    const src = o.source
    let from: string | null = null
    if (src.grp === 'MAIN') from = `main:${src.in}`
    else if (src.grp === 'MTX') from = `matrix:${src.in}`
    else if (src.grp === 'BUS') from = `bus:${src.in}`
    else if (src.grp !== 'MON') from = inputNode(src.grp, src.in) // an input passed straight through (the USB and card recorders)
    if (from && !nodes.has(from)) continue // patched to something the snapshot does not name
    add({ id, kind: 'out', label, sub: src.grp === 'MON' ? 'monitor' : `${src.grp} ${src.in}`, color: 0, muted: false })
    if (from) edges.push({ from, to: id, kind: 'patch', label: '', muted: false })
  }

  return { nodes: [...nodes.values()], edges }
}

/** Everything that feeds `start` and everything it feeds, following the signal both ways (the path through the venue). */
export function trace(edges: FlowEdge[], start: string): Set<string> {
  const found = new Set<string>([start])
  for (const dir of ['down', 'up'] as const) {
    const queue = [start]
    while (queue.length) {
      const at = queue.pop()!
      for (const e of edges) {
        const next = dir === 'down' ? (e.from === at ? e.to : null) : (e.to === at ? e.from : null)
        if (next && !found.has(next)) { found.add(next); queue.push(next) }
      }
    }
  }
  return found
}
