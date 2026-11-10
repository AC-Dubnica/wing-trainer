import { MAX_BUSES, MAX_MATRICES, type Bus, type Matrix, type Snapshot } from './model'

/** Names on the console are at most this long. */
export const NAME_LENGTH = 16

export const freeBusId = (s: Snapshot): number | null => {
  const used = new Set(s.buses.map((b) => b.id))
  for (let id = 1; id <= MAX_BUSES; id++) if (!used.has(id)) return id
  return null
}

export const freeMatrixId = (s: Snapshot): number | null => {
  const used = new Set(s.matrices.map((m) => m.id))
  for (let id = 1; id <= MAX_MATRICES; id++) if (!used.has(id)) return id
  return null
}

const clean = (name: string, fallback: string): string => name.trim().slice(0, NAME_LENGTH) || fallback

/** A channel's send to a bus, all the way down and off (the entry is made if the channel has none). */
function silenceSends(s: Snapshot, bus: number): void {
  for (const c of s.channels) {
    const send = c.sends.find((x) => x.bus === bus)
    if (send) Object.assign(send, { on: false, level: -144, pre: false })
    else { c.sends.push({ bus, on: false, level: -144, pre: false }); c.sends.sort((a, b) => a.bus - b.bus) }
  }
}

/** A bus's or a main's send to a matrix, off (the entry is made if it has none). */
function silenceMatrixSend(s: Snapshot, mtx: number): void {
  for (const b of s.buses) {
    const x = b.matrix.find((m) => m.mtx === mtx)
    if (x) Object.assign(x, { on: false, level: -144 })
    else { b.matrix.push({ mtx, on: false, level: -144 }); b.matrix.sort((p, q) => p.mtx - q.mtx) }
  }
  for (const m of s.mains) {
    const x = m.matrix.find((y) => y.mtx === mtx)
    if (x) Object.assign(x, { on: false, level: -144 })
    else { m.matrix.push({ mtx, on: false, level: -144 }); m.matrix.sort((p, q) => p.mtx - q.mtx) }
  }
}

/** Takes the output ports that carry a removed bus or matrix out of the patch (they would carry nothing). */
const unpatch = (s: Snapshot, grp: string, id: number): void => { s.outputs = s.outputs.filter((o) => !(o.source.grp === grp && o.source.in === id)) }

/**
 * A new bus on the lowest free number. Nothing is sent to it: every channel's send to it is off, and it is assigned to no main and
 * sends to no matrix. Returns null when all of the console's buses are in use.
 */
export function addBus(s: Snapshot, name: string): Bus | null {
  const id = freeBusId(s)
  if (id === null) return null
  silenceSends(s, id) // a slot that was empty may still hold old values
  const bus: Bus = {
    id,
    name: clean(name, `BUS ${id}`),
    mute: false,
    fader: 0,
    mains: s.mains.map((m) => ({ main: m.id, on: false, level: 0 })),
    matrix: s.matrices.map((m) => ({ mtx: m.id, on: false, level: -144 })),
  }
  s.buses.push(bus)
  s.buses.sort((a, b) => a.id - b.id)
  return bus
}

/** Removes a bus: it goes, every channel's send to it is switched off, and the outputs that carried it are unpatched. */
export function removeBus(s: Snapshot, id: number): boolean {
  if (!s.buses.some((b) => b.id === id)) return false
  s.buses = s.buses.filter((b) => b.id !== id)
  silenceSends(s, id)
  unpatch(s, 'BUS', id)
  return true
}

/** A new matrix on the lowest free number, with nothing sent to it. Null when all of the console's matrices are in use. */
export function addMatrix(s: Snapshot, name: string): Matrix | null {
  const id = freeMatrixId(s)
  if (id === null) return null
  silenceMatrixSend(s, id)
  const m: Matrix = { id, name: clean(name, `MATRIX ${id}`), mute: false, fader: 0 }
  s.matrices.push(m)
  s.matrices.sort((a, b) => a.id - b.id)
  return m
}

/** Removes a matrix: it goes, the buses' sends to it are switched off, and the outputs that carried it are unpatched. */
export function removeMatrix(s: Snapshot, id: number): boolean {
  if (!s.matrices.some((m) => m.id === id)) return false
  s.matrices = s.matrices.filter((m) => m.id !== id)
  silenceMatrixSend(s, id)
  unpatch(s, 'MTX', id)
  return true
}

/** Gives a bus or matrix another name (at most 16 characters; an empty name is ignored). */
export function renameMix(s: Snapshot, kind: 'bus' | 'matrix', id: number, name: string): boolean {
  const target = (kind === 'bus' ? s.buses : s.matrices).find((x) => x.id === id)
  const n = name.trim().slice(0, NAME_LENGTH)
  if (!target || !n) return false
  target.name = n
  return true
}
