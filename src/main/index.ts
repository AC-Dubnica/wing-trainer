import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'

const AUDIO = new Set(['.wav', '.flac', '.mp3', '.ogg', '.aif', '.aiff', '.m4a'])
/** A decoded recording is about ten times its file size in memory: refuse files that would not fit. */
const MAX_BYTES = 200 * 1024 * 1024

let win: BrowserWindow | null = null

function createWindow(): void {
  win = new BrowserWindow({
    width: 1500,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: 'WING Trainer',
    backgroundColor: '#14161b',
    show: !process.env.WING_TRAINER_EVAL || !!process.env.WING_TRAINER_SHOT,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: true },
  })
  void win.loadFile(join(__dirname, '../renderer/index.html'))
  // Dev hook for the picture in the README: WING_TRAINER_SHOT=file.png (after WING_TRAINER_SHOT_JS, if any, has run).
  const shot = process.env.WING_TRAINER_SHOT
  if (shot) {
    win.webContents.once('did-finish-load', async () => {
      await new Promise((r) => setTimeout(r, 2500))
      if (process.env.WING_TRAINER_SHOT_JS) { await win!.webContents.executeJavaScript(process.env.WING_TRAINER_SHOT_JS); await new Promise((r) => setTimeout(r, 800)) }
      writeFileSync(shot, (await win!.webContents.capturePage()).toPNG())
      app.quit()
    })
  }
  // Dev hook for the end-to-end test: run JS in the page, print the result, quit.
  const code = process.env.WING_TRAINER_EVAL
  if (code) {
    win.webContents.once('did-finish-load', async () => {
      try {
        console.log('EVAL', JSON.stringify(await win!.webContents.executeJavaScript(code)))
      } catch (e) {
        console.log('EVAL_ERROR', String(e))
      }
      app.quit()
    })
  }
}

ipcMain.handle('snapshot:open', async () => {
  const r = await dialog.showOpenDialog(win!, { title: 'Open a WING snapshot', properties: ['openFile'], filters: [{ name: 'WING snapshot', extensions: ['snap', 'json'] }, { name: 'All files', extensions: ['*'] }] })
  if (r.canceled || !r.filePaths[0]) return null
  return { name: r.filePaths[0].split(/[\\/]/).pop() ?? '', text: readFileSync(r.filePaths[0], 'utf8') }
})

ipcMain.handle('audio:folder', async () => {
  const r = await dialog.showOpenDialog(win!, { title: 'Open a recording (a folder of tracks)', properties: ['openDirectory'] })
  if (r.canceled || !r.filePaths[0]) return null
  const dir = r.filePaths[0]
  const files = readdirSync(dir).filter((f) => AUDIO.has(extname(f).toLowerCase()) && !f.startsWith('.')).map((f) => ({ name: f, path: join(dir, f), bytes: statSync(join(dir, f)).size }))
  return { dir, files }
})

ipcMain.handle('audio:file', async () => {
  const r = await dialog.showOpenDialog(win!, { title: 'Open an audio file', properties: ['openFile'], filters: [{ name: 'Audio', extensions: [...AUDIO].map((e) => e.slice(1)) }] })
  if (r.canceled || !r.filePaths[0]) return null
  return { name: r.filePaths[0].split(/[\\/]/).pop() ?? '', path: r.filePaths[0], bytes: statSync(r.filePaths[0]).size }
})

ipcMain.handle('audio:read', (_e, path: string) => {
  if (typeof path !== 'string' || !AUDIO.has(extname(path).toLowerCase())) throw new Error('Not an audio file.')
  if (statSync(path).size > MAX_BYTES) throw new Error('This file is too large (over 200 MB). Use a shorter excerpt of the recording.')
  const buf = readFileSync(path)
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
})

void app.whenReady().then(createWindow)
app.on('window-all-closed', () => app.quit())
