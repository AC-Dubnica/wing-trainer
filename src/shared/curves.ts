import { eqBands, cutFilters, type BiquadSpec } from './convert'
import type { Comp, Eq, Filters, Gate } from './model'

/** The magnitude (dB) of one biquad filter at `freq`, from the standard "audio EQ cookbook" formulas. */
export function responseDb(spec: BiquadSpec, freq: number, rate = 48000): number {
  const w0 = (2 * Math.PI * Math.min(spec.freq, rate / 2 - 1)) / rate
  const cos = Math.cos(w0)
  const sin = Math.sin(w0)
  const A = 10 ** (spec.gain / 40)
  const alpha = sin / (2 * spec.q)
  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number
  switch (spec.type) {
    case 'peaking':
      b0 = 1 + alpha * A; b1 = -2 * cos; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cos; a2 = 1 - alpha / A
      break
    case 'lowshelf': {
      const s = 2 * Math.sqrt(A) * alpha
      b0 = A * (A + 1 - (A - 1) * cos + s); b1 = 2 * A * (A - 1 - (A + 1) * cos); b2 = A * (A + 1 - (A - 1) * cos - s)
      a0 = A + 1 + (A - 1) * cos + s; a1 = -2 * (A - 1 + (A + 1) * cos); a2 = A + 1 + (A - 1) * cos - s
      break
    }
    case 'highshelf': {
      const s = 2 * Math.sqrt(A) * alpha
      b0 = A * (A + 1 + (A - 1) * cos + s); b1 = -2 * A * (A - 1 + (A + 1) * cos); b2 = A * (A + 1 + (A - 1) * cos - s)
      a0 = A + 1 - (A - 1) * cos + s; a1 = 2 * (A - 1 - (A + 1) * cos); a2 = A + 1 - (A - 1) * cos - s
      break
    }
    case 'highpass':
      b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = (1 + cos) / 2; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha
      break
    default:
      b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = (1 - cos) / 2; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha
  }
  const w = (2 * Math.PI * freq) / rate
  const c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w)
  const nr = b0 + b1 * c1 + b2 * c2, ni = -(b1 * s1 + b2 * s2)
  const dr = a0 + a1 * c1 + a2 * c2, di = -(a1 * s1 + a2 * s2)
  return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di))
}

export const EQ_MIN_HZ = 20
export const EQ_MAX_HZ = 20000

/** The frequency response of a channel's cuts and six-band EQ, at log-spaced points from 20 Hz to 20 kHz. */
export function eqCurve(eq: Eq, filters: Filters, points = 160): { freq: number[]; db: number[] } {
  const specs = [...eqBands(eq), ...(filters.lowCut.on ? [cutFilters(filters).low] : []), ...(filters.highCut.on ? [cutFilters(filters).high] : [])]
  const freq: number[] = []
  const db: number[] = []
  for (let i = 0; i < points; i++) {
    const f = EQ_MIN_HZ * (EQ_MAX_HZ / EQ_MIN_HZ) ** (i / (points - 1))
    freq.push(f)
    db.push(specs.reduce((sum, s) => sum + responseDb(s, f), 0))
  }
  return { freq, db }
}

/** The compressor's static curve: output level for an input level (both dB), with the soft knee and make-up gain of the simulation. */
export function compCurve(c: Pick<Comp, 'on' | 'threshold' | 'ratio' | 'knee' | 'makeup'>, inDb: number): number {
  if (!c.on) return inDb
  const over = inDb - c.threshold
  let out: number
  if (2 * over < -c.knee) out = inDb
  else if (2 * Math.abs(over) <= c.knee) out = inDb + ((1 / c.ratio - 1) * (over + c.knee / 2) ** 2) / (2 * c.knee)
  else out = c.threshold + over / c.ratio
  return out + c.makeup
}

/** The gate's static curve: below the threshold the level goes down by the range. */
export function gateCurve(g: Pick<Gate, 'on' | 'threshold' | 'range'>, inDb: number): number {
  return g.on && inDb < g.threshold ? inDb - g.range : inDb
}
