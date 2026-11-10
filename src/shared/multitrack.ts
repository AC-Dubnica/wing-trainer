import type { Snapshot } from './model'

/** The track number in a recording's file name: the last group of one to three digits ("Track 03.wav", "20260517_07.wav", "ch12"). */
export function trackNumber(fileName: string): number | null {
  const base = fileName.replace(/\.[^./\\]+$/, '')
  const groups = base.match(/\d+/g)
  if (!groups) return null
  const last = groups[groups.length - 1]
  return last.length <= 3 ? Number(last) : null
}

export interface TrackAssignment {
  file: string
  track: number
  /** The channels that take this input (several channels can be patched to the same input). */
  channels: number[]
}

export interface TrackMapping {
  assigned: TrackAssignment[]
  /** Files that could not be placed: no track number in the name, or nothing patched to that recorder track. */
  unmatched: string[]
}

/**
 * Which channel plays which file. The console's USB recorder writes one track per recorder output; the snapshot says which input
 * each output takes, and which channels are patched to that input, so a multitrack recording can be placed without any setup.
 */
export function mapTracks(snapshot: Snapshot, files: string[]): TrackMapping {
  const assigned: TrackAssignment[] = []
  const unmatched: string[] = []
  const used = new Set<number>()
  for (const file of [...files].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
    const track = trackNumber(file)
    const out = track === null ? undefined : snapshot.usbOut.find((o) => o.track === track)
    const channels = out ? snapshot.channels.filter((c) => c.hasSource && c.source.grp === out.source.grp && c.source.in === out.source.in).map((c) => c.id) : []
    if (track === null || !channels.length || used.has(track)) { unmatched.push(file); continue }
    used.add(track)
    assigned.push({ file, track, channels })
  }
  return { assigned, unmatched }
}
