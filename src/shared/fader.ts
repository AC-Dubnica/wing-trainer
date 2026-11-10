/** The fader's range, in dB (the bottom of the travel is "off"). */
export const FADER_MIN = -70
export const FADER_MAX = 10

/** The fader's travel is not linear in dB: like the console's, it spends more of its length near 0 dB. [dB, position 0..1] */
export const TRAVEL: readonly [number, number][] = [[-70, 0], [-60, 0.07], [-40, 0.27], [-20, 0.5], [-10, 0.68], [0, 0.85], [10, 1]]

/** Where a level sits along the travel (0 = bottom, 1 = top). The meters use the same scale. */
export function posOf(db: number): number {
  const d = Math.min(FADER_MAX, Math.max(FADER_MIN, db))
  for (let i = 1; i < TRAVEL.length; i++) {
    if (d <= TRAVEL[i][0]) {
      const [d0, p0] = TRAVEL[i - 1]
      const [d1, p1] = TRAVEL[i]
      return p0 + ((d - d0) / (d1 - d0)) * (p1 - p0)
    }
  }
  return 1
}

/** The level at a position along the travel. */
export function dbAt(pos: number): number {
  const p = Math.min(1, Math.max(0, pos))
  for (let i = 1; i < TRAVEL.length; i++) {
    if (p <= TRAVEL[i][1]) {
      const [d0, p0] = TRAVEL[i - 1]
      const [d1, p1] = TRAVEL[i]
      return d0 + ((p - p0) / (p1 - p0)) * (d1 - d0)
    }
  }
  return FADER_MAX
}
