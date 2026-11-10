import { app, BrowserWindow, dialog, ipcMain, screen } from 'electron'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { emptySession, isVisible, sanitizeSession, type Session } from '../shared/session'

const AUDIO = new Set(['.wav', '.flac', '.mp3', '.ogg', '.aif', '.aiff', '.m4a'])
/** A decoded recording is about ten times its file size in memory: refuse files that would not fit. */
const MAX_BYTES = 200 * 1024 * 1024

/** The tests and the picture hooks run on their own and must neither read nor change what the user's own runs remember. */
const scratch = process.env.WING_TRAINER_USER_DATA
if (scratch) app.setPath('userData', scratch) // a test that wants to try the remembering uses a folder of its own
const testing = !!(process.env.WING_TRAINER_EVAL || process.env.WING_TRAINER_SHOT || process.env.WING_TRAINER_SIZE) && !scratch

let win: BrowserWindow | null = null

// --- what is remembered between runs -----------------------------------------------------------------------------------------

const sessionFile = (): string => join(app.getPath('userData'), 'session.json')
let session: Session = emptySession()

function loadSession(): void {
  if (testing) return
  try {
    session = sanitizeSession(JSON.parse(readFileSync(sessionFile(), 'utf8')))
  } catch {
    session = emptySession() // nothing saved yet, or a file that cannot be read: start fresh
  }
}

let saveTimer: NodeJS.Timeout | null = null
/** Writes the session a moment after the last change (it changes with every window move and every edit). */
function saveSoon(): void {
  if (testing) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(saveNow, 400)
}
function saveNow(): void {
  if (testing) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = null
  try {
    mkdirSync(app.getPath('userData'), { recursive: true })
    const tmp = `${sessionFile()}.tmp`
    writeFileSync(tmp, JSON.stringify(session))
    renameSync(tmp, sessionFile()) // never leave a half-written file
  } catch {
    /* what is remembered is a convenience: never stop the app for it */
  }
}

/** The folder a dialog should open in, if it still exists. */
const startDir = (dir: string): string | undefined => (dir && existsSync(dir) ? dir : undefined)

// --- the window --------------------------------------------------------------------------------------------------------------

function createWindow(): void {
  const size = process.env.WING_TRAINER_SIZE?.split('x').map(Number)
  const saved = session.window.bounds && isVisible(session.window.bounds, screen.getAllDisplays().map((d) => d.workArea)) ? session.window.bounds : null
  win = new BrowserWindow({
    width: size?.[0] || saved?.width || 1500,
    height: size?.[1] || saved?.height || 900,
    ...(saved && !size ? { x: saved.x, y: saved.y } : {}),
    minWidth: testing && size ? 400 : 1100,
    minHeight: testing && size ? 300 : 700,
    title: 'WING Trainer',
    backgroundColor: '#14161b',
    show: false,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: true },
  })
  const w = win
  if (!testing && session.window.maximized) w.maximize()
  w.once('ready-to-show', () => { if (!process.env.WING_TRAINER_EVAL || process.env.WING_TRAINER_SHOT) w.show() })

  // Remember the size and place of the window, and whether it was maximized.
  const remember = (): void => {
    if (testing || w.isDestroyed() || w.isMinimized() || w.isFullScreen()) return
    session.window = { bounds: w.isMaximized() ? session.window.bounds : w.getBounds(), maximized: w.isMaximized() }
    saveSoon()
  }
  w.on('resize', remember)
  w.on('move', remember)
  w.on('maximize', remember)
  w.on('unmaximize', remember)
  w.on('close', () => { remember(); saveNow() })

  void w.loadFile(join(__dirname, '../renderer/index.html'))
  // Dev hook for the picture in the README: WING_TRAINER_SHOT=file.png (after WING_TRAINER_SHOT_JS, if any, has run).
  const shot = process.env.WING_TRAINER_SHOT
  if (shot) {
    w.webContents.once('did-finish-load', async () => {
      await new Promise((r) => setTimeout(r, 2500))
      if (process.env.WING_TRAINER_SHOT_JS) { await w.webContents.executeJavaScript(process.env.WING_TRAINER_SHOT_JS); await new Promise((r) => setTimeout(r, 800)) }
      writeFileSync(shot, (await w.webContents.capturePage()).toPNG())
      app.quit()
    })
  }
  // Dev hook for the end-to-end test: run JS in the page, print the result, quit.
  const code = process.env.WING_TRAINER_EVAL
  if (code) {
    w.webContents.once('did-finish-load', async () => {
      try {
        console.log('EVAL', JSON.stringify(await w.webContents.executeJavaScript(code)))
      } catch (e) {
        console.log('EVAL_ERROR', String(e))
      }
      app.quit()
    })
  }
}

// --- files -------------------------------------------------------------------------------------------------------------------

const readSnapshot = (path: string): { name: string; path: string; text: string } | null => {
  try {
    return { name: basename(path), path, text: readFileSync(path, 'utf8') }
  } catch {
    return null
  }
}

/** The session at start: the snapshot that was open (read again from its file) and where the work ended. */
ipcMain.handle('session:load', () => ({
  snapshot: session.snapshotPath ? readSnapshot(session.snapshotPath) : null,
  state: session.state,
}))

ipcMain.handle('session:save', (_e, state: unknown) => {
  session.state = state
  saveSoon()
})

ipcMain.handle('snapshot:open', async () => {
  const r = await dialog.showOpenDialog(win!, { title: 'Open a WING snapshot', defaultPath: startDir(session.dirs.snapshot), properties: ['openFile'], filters: [{ name: 'WING snapshot', extensions: ['snap', 'json'] }, { name: 'All files', extensions: ['*'] }] })
  if (r.canceled || !r.filePaths[0]) return null
  const path = r.filePaths[0]
  const file = readSnapshot(path)
  if (file) { session.dirs.snapshot = dirname(path); session.snapshotPath = path; saveSoon() }
  return file
})

const listAudio = (dir: string): { dir: string; files: { name: string; path: string; bytes: number }[] } | null => {
  try {
    return { dir, files: readdirSync(dir).filter((f) => AUDIO.has(extname(f).toLowerCase()) && !f.startsWith('.')).map((f) => ({ name: f, path: join(dir, f), bytes: statSync(join(dir, f)).size })) }
  } catch {
    return null
  }
}

/** A recording folder: asked for with a dialog, or (with `again`) the same folder as before, without asking. */
ipcMain.handle('audio:folder', async (_e, again?: string) => {
  if (typeof again === 'string' && again) return listAudio(again)
  const r = await dialog.showOpenDialog(win!, { title: 'Open a recording (a folder of tracks)', defaultPath: startDir(session.dirs.recording), properties: ['openDirectory'] })
  if (r.canceled || !r.filePaths[0]) return null
  session.dirs.recording = r.filePaths[0]
  saveSoon()
  return listAudio(r.filePaths[0])
})

ipcMain.handle('audio:file', async () => {
  const r = await dialog.showOpenDialog(win!, { title: 'Open an audio file', defaultPath: startDir(session.dirs.audio) ?? startDir(session.dirs.recording), properties: ['openFile'], filters: [{ name: 'Audio', extensions: [...AUDIO].map((e) => e.slice(1)) }] })
  if (r.canceled || !r.filePaths[0]) return null
  session.dirs.audio = dirname(r.filePaths[0])
  saveSoon()
  return { name: basename(r.filePaths[0]), path: r.filePaths[0], bytes: statSync(r.filePaths[0]).size }
})

ipcMain.handle('audio:read', (_e, path: string) => {
  if (typeof path !== 'string' || !AUDIO.has(extname(path).toLowerCase())) throw new Error('Not an audio file.')
  if (statSync(path).size > MAX_BYTES) throw new Error('This file is too large (over 200 MB). Use a shorter excerpt of the recording.')
  const buf = readFileSync(path)
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
})

// A snapshot dropped back to the sample: forget the file.
ipcMain.handle('session:sample', () => {
  session.snapshotPath = ''
  saveSoon()
})

void app.whenReady().then(() => {
  loadSession()
  createWindow()
})
app.on('window-all-closed', () => { saveNow(); app.quit() })
