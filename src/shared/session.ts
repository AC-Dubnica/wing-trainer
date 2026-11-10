/** What the app remembers between runs (session.json in the user's data folder): the window, the folders, and where the work ended. */

export interface Rect { x: number; y: number; width: number; height: number }

export interface WindowState {
  /** The window's size and position when it is not maximized. */
  bounds: Rect | null
  maximized: boolean
}

export interface Session {
  window: WindowState
  /** The folder each file dialog opens in next time. */
  dirs: { snapshot: string; recording: string; audio: string }
  /** The snapshot file that was open (empty = the sample). */
  snapshotPath: string
  /** Where the user had got to (see `WorkState` in the screen's code); opaque here. */
  state: unknown
}

export const emptySession = (): Session => ({ window: { bounds: null, maximized: true }, dirs: { snapshot: '', recording: '', audio: '' }, snapshotPath: '', state: null })

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null)

export function sanitizeSession(raw: unknown): Session {
  const r = obj(raw)
  const w = obj(r.window)
  const b = obj(w.bounds)
  const width = int(b.width), height = int(b.height), x = int(b.x), y = int(b.y)
  const bounds: Rect | null = width !== null && height !== null && width >= 300 && height >= 200 && x !== null && y !== null ? { x, y, width, height } : null
  const d = obj(r.dirs)
  return {
    // Maximized unless the window was last left in a normal size.
    window: { bounds, maximized: w.maximized !== false },
    dirs: { snapshot: str(d.snapshot), recording: str(d.recording), audio: str(d.audio) },
    snapshotPath: str(r.snapshotPath),
    state: r.state ?? null,
  }
}

/** Whether a window at `bounds` would be seen: at least 100 x 60 px of it on one of the displays (a screen that was unplugged leaves it off screen). */
export function isVisible(bounds: Rect, displays: Rect[]): boolean {
  return displays.some((d) => {
    const w = Math.min(bounds.x + bounds.width, d.x + d.width) - Math.max(bounds.x, d.x)
    const h = Math.min(bounds.y + bounds.height, d.y + d.height) - Math.max(bounds.y, d.y)
    return w >= 100 && h >= 60
  })
}
