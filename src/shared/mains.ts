import type { Snapshot } from './model'

/**
 * A main is a stereo pair of signals. In the output patch the source group MAIN lists them one after the other: 1 is the left of main 1,
 * 2 its right, 3 the left of main 2, 4 its right, and so on (a mono main is one entry). So `C 7 <- MAIN 1` and `C 8 <- MAIN 2` is the
 * left and the right of the PA, not the PA and a second main. (WING Quick Start Guide: "select MAIN ... assign 1L to output 7 and 1R to output 8".)
 */
export interface MainSide { index: number; main: number; side: 'L' | 'R' | 'M' }

export function mainSides(s: Pick<Snapshot, 'mainMono'>): MainSide[] {
  const out: MainSide[] = []
  for (let main = 1; main <= 4; main++) {
    if (s.mainMono?.[main - 1]) out.push({ index: out.length + 1, main, side: 'M' })
    else { out.push({ index: out.length + 1, main, side: 'L' }); out.push({ index: out.length + 1, main, side: 'R' }) }
  }
  return out
}

/** Which main, and which side of it, an index of the MAIN source group is. */
export const mainOfIndex = (s: Pick<Snapshot, 'mainMono'>, index: number): MainSide | null => mainSides(s).find((m) => m.index === index) ?? null

/** How many entries the MAIN source group has. */
export const mainSourceCount = (s: Pick<Snapshot, 'mainMono'>): number => mainSides(s).length

const WORD = { L: 'left', R: 'right', M: '' } as const

/** "PA left", "SUB right", "PA" for a mono main: what a MAIN source index is, in words. */
export function mainSourceName(s: Pick<Snapshot, 'mainMono' | 'mains'>, index: number): string {
  const m = mainOfIndex(s, index)
  if (!m) return `MAIN ${index}`
  const name = s.mains.find((x) => x.id === m.main)?.name || `main ${m.main}`
  return `${name}${WORD[m.side] ? ` ${WORD[m.side]}` : ''}`
}
