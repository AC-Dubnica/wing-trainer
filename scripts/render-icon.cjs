// Renders build/icon.svg to build/icon.png (1024×1024, transparent corners) using Electron's own renderer, so no extra
// tools are needed. On macOS it also builds build/icon.icns. Run: npx electron scripts/render-icon.cjs
const { app, BrowserWindow } = require('electron')
const { readFileSync, writeFileSync, mkdirSync, rmSync } = require('node:fs')
const { join } = require('node:path')
const { spawnSync } = require('node:child_process')

const root = join(__dirname, '..')
const svg = readFileSync(join(root, 'build', 'icon.svg'), 'utf8')
const SIZE = 1024

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  // Offscreen rendering paints at exactly SIZE×SIZE with real transparency (a normal capture would follow the display's scale).
  const win = new BrowserWindow({ width: SIZE, height: SIZE, show: false, frame: false, transparent: true, webPreferences: { offscreen: true } })
  let png = null
  // Chromium paints a blank frame first. Keep the latest one, give the page time to draw, force a repaint, then use that.
  win.webContents.on('paint', (_e, _dirty, image) => { if (image.getSize().width === SIZE) png = image.toPNG() })
  const page = `<html><body style="margin:0;background:transparent;overflow:hidden">${svg.replace('<svg ', `<svg style="display:block" `)}</body></html>`
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`)
  win.webContents.setFrameRate(10)
  await new Promise((r) => setTimeout(r, 1000))
  win.webContents.invalidate()
  await new Promise((r) => setTimeout(r, 700))
  if (!png) throw new Error('The icon was not painted')
  writeFileSync(join(root, 'build', 'icon.png'), png)
  console.log('wrote build/icon.png')

  if (process.platform === 'darwin') {
    const set = join(root, 'build', 'icon.iconset')
    rmSync(set, { recursive: true, force: true })
    mkdirSync(set)
    for (const [name, px] of [['16x16', 16], ['16x16@2x', 32], ['32x32', 32], ['32x32@2x', 64], ['128x128', 128], ['128x128@2x', 256], ['256x256', 256], ['256x256@2x', 512], ['512x512', 512], ['512x512@2x', 1024]]) {
      spawnSync('sips', ['-z', String(px), String(px), join(root, 'build', 'icon.png'), '--out', join(set, `icon_${name}.png`)], { stdio: 'ignore' })
    }
    const r = spawnSync('iconutil', ['-c', 'icns', set, '-o', join(root, 'build', 'icon.icns')], { encoding: 'utf8' })
    rmSync(set, { recursive: true, force: true })
    console.log(r.status === 0 ? 'wrote build/icon.icns' : `iconutil failed: ${r.stderr}`)
  }
  app.quit()
})
