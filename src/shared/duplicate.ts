import { MAX_CHANNELS, type Channel, type Snapshot, type Source } from './model'

/** The lowest channel number that is not used yet, or null when all of the console's channels are taken. */
export function freeChannelId(s: Snapshot): number | null {
  const used = new Set(s.channels.map((c) => c.id))
  for (let id = 1; id <= MAX_CHANNELS; id++) if (!used.has(id)) return id
  return null
}

/** The first port of a group, from `start` on, that no channel listens to yet (`start` itself if they all do). */
export function nextFreePort(s: Snapshot, grp: string, start: number, max: number): number {
  const used = new Set(s.channels.filter((c) => c.hasSource && c.source.grp === grp).map((c) => c.source.in))
  for (let p = start + 1; p <= max; p++) if (!used.has(p)) return p
  return start
}

export type DuplicateResult = { ok: true; channel: Channel } | { ok: false; reason: string }

/**
 * Copies a channel to a free channel number, listening to a new input. Everything on the strip is copied (trim, filters, EQ, gate,
 * compressor, fader, pan, mute, the sends to buses and the assignments to mains); the copy is added to the snapshot and is independent of
 * the original. The name is the original's with " copy" unless one is given.
 */
export function duplicateChannel(s: Snapshot, fromId: number, input: Source, name?: string): DuplicateResult {
  const from = s.channels.find((c) => c.id === fromId)
  if (!from) return { ok: false, reason: 'That channel does not exist.' }
  const id = freeChannelId(s)
  if (id === null) return { ok: false, reason: `All ${MAX_CHANNELS} channels of the console are in use.` }
  if (!input.grp || input.grp === 'OFF') return { ok: false, reason: 'Choose an input for the copy.' }
  const copy: Channel = structuredClone(from)
  copy.id = id
  copy.copyOf = from.id
  copy.name = (name?.trim() || `${from.name || `Ch ${from.id}`} copy`).slice(0, 16)
  copy.source = { grp: input.grp, in: input.in }
  copy.hasSource = true
  s.channels.push(copy)
  s.channels.sort((a, b) => a.id - b.id)
  return { ok: true, channel: copy }
}
