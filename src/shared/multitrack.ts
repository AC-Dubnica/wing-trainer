import type { RecorderTrack, Snapshot } from './model'

/** The track number in a recording's file name: the last group of one to three digits ("Track 03.wav", "20260517_07.wav", "ch12"). */
export function trackNumber(fileName: string): number | null {
  const base = fileName.replace(/\.[^./\\]+$/, '')
  const groups = base.match(/\d+/g)
  if (!groups) return null
  const last = groups[groups.length - 1]
  return last.length <= 3 ? Number(last) : null
}

/** The recorder's tracks: the USB outputs that are patched, with the input each one takes. */
export const recorderTracks = (s: Snapshot): RecorderTrack[] => s.outputs.filter((o) => o.grp === 'USB').map((o) => ({ track: o.port, source: o.source }))

/** Which side of a channel a track is: a mono channel takes the whole track, a stereo channel takes one track for its left and the next input's track for its right. */
export type Side = 'mono' | 'left' | 'right'

export interface Placement { channel: number; side: Side }

export interface TrackAssignment {
  file: string
  track: number
  /** The channels that use this track (several channels can be patched to the same input). */
  channels: number[]
  /** The same, with the side of each channel the track is. */
  placements: Placement[]
}

export interface TrackMapping {
  assigned: TrackAssignment[]
  /** Files that could not be placed: no track number in the name, or nothing patched to that recorder track. */
  unmatched: string[]
}

/**
 * Which channel plays which file. The console's USB recorder writes one track per recorder output; the snapshot says which input
 * each output takes, and which channels are patched to that input, so a multitrack recording can be placed without any setup.
 * A stereo channel (a pair of input ports, such as a piano on C 9 and C 10) plays two tracks: its own input's for the left side and the
 * next port's for the right side.
 */
export function mapTracks(snapshot: Snapshot, files: string[]): TrackMapping {
  const assigned: TrackAssignment[] = []
  const unmatched: string[] = []
  const used = new Set<number>()
  for (const file of [...files].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
    const track = trackNumber(file)
    const out = track === null ? undefined : recorderTracks(snapshot).find((o) => o.track === track)
    // A mono channel takes the track of its input; a stereo channel takes the track of its input (left) and of the next port (right).
    const placements: Placement[] = []
    if (out) {
      for (const c of snapshot.channels) {
        if (!c.hasSource || c.source.grp !== out.source.grp) continue
        if (c.stereo === null) { if (c.source.in === out.source.in) placements.push({ channel: c.id, side: 'mono' }) }
        else if (c.source.in === out.source.in) placements.push({ channel: c.id, side: 'left' })
        else if (c.source.in + 1 === out.source.in) placements.push({ channel: c.id, side: 'right' })
      }
    }
    const channels = placements.map((p) => p.channel)
    if (track === null || !channels.length || used.has(track)) { unmatched.push(file); continue }
    used.add(track)
    assigned.push({ file, track, channels, placements })
  }
  return { assigned, unmatched }
}
