import { OFF_DB, type Comp, type Eq, type Filters, type Gate } from './model'

/** A level in dB as a gain factor; the console's "all the way down" is silence. */
export const dbToGain = (db: number): number => (db <= OFF_DB ? 0 : 10 ** (db / 20))
export const gainToDb = (gain: number): number => (gain <= 1e-5 ? -100 : 20 * Math.log10(gain))
export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/** The console's pan (-100 to 100) as the Web Audio pan (-1 to 1). */
export const panValue = (pan: number): number => clamp(pan / 100, -1, 1)

/** What the gate worklet takes (see src/renderer/gate-worklet.js). */
export function gateParams(g: Gate): Record<string, number> {
  return { enabled: g.on ? 1 : 0, threshold: clamp(g.threshold, -100, 0), range: clamp(g.range, 0, 90), attack: clamp(g.attack, 0.1, 200), hold: clamp(g.hold, 0, 2000), release: clamp(g.release, 1, 5000) }
}

/** What the compressor worklet takes. Only the console's COMP model is simulated; the others pass the signal through. */
export function compParams(c: Comp): Record<string, number> {
  return {
    enabled: c.on && c.model === 'COMP' ? 1 : 0,
    threshold: clamp(c.threshold, -80, 0),
    ratio: clamp(c.ratio, 1, 100),
    knee: clamp(c.knee, 0, 40),
    attack: clamp(c.attack, 0.01, 500),
    release: clamp(c.release, 1, 5000),
    makeup: clamp(c.makeup, 0, 36),
  }
}

export interface BiquadSpec { type: 'lowshelf' | 'peaking' | 'highshelf' | 'highpass' | 'lowpass'; freq: number; gain: number; q: number }

/** The six equalizer bands of a channel as filters; with the EQ off every band has no gain. */
export function eqBands(eq: Eq): BiquadSpec[] {
  const g = (v: number): number => (eq.on ? clamp(v, -18, 18) : 0)
  return [
    { type: eq.low.shelf ? 'lowshelf' : 'peaking', freq: clamp(eq.low.freq, 20, 20000), gain: g(eq.low.gain), q: clamp(eq.low.q, 0.2, 20) },
    ...eq.bands.map((b): BiquadSpec => ({ type: 'peaking', freq: clamp(b.freq, 20, 20000), gain: g(b.gain), q: clamp(b.q, 0.2, 20) })),
    { type: eq.high.shelf ? 'highshelf' : 'peaking', freq: clamp(eq.high.freq, 20, 20000), gain: g(eq.high.gain), q: clamp(eq.high.q, 0.2, 20) },
  ]
}

/** The low-cut and high-cut as filters; an inactive one is moved out of the way. */
export function cutFilters(f: Filters): { low: BiquadSpec; high: BiquadSpec } {
  return {
    low: { type: 'highpass', freq: f.lowCut.on ? clamp(f.lowCut.freq, 20, 2000) : 10, gain: 0, q: 0.707 },
    high: { type: 'lowpass', freq: f.highCut.on ? clamp(f.highCut.freq, 1000, 20000) : 20000, gain: 0, q: 0.707 },
  }
}
