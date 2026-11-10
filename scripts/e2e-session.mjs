// End-to-end check of what the app remembers: the window (size, place, maximized), the snapshot file that was open, the folders of the
// file dialogs, and where the work ended (edits, selection, fader order, the open tab). It runs the real app twice on a scratch data
// folder: the first run works, the second must find everything as it was left. Needs a display.
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureElectron } from './electron-path.mjs'

const electronPath = await ensureElectron()
const root = join(process.env.E2E_OUT_DIR || tmpdir(), 'wing-trainer-e2e-session')
rmSync(root, { recursive: true, force: true })
const data = join(root, 'data')
mkdirSync(data, { recursive: true })
const snap = join(root, 'my setup.snap')
copyFileSync(new URL('../fixtures/sample.snap.json', import.meta.url).pathname, snap)

const run = (code, env = {}) => {
  const r = spawnSync(electronPath, ['.'], { env: { ...process.env, WING_TRAINER_USER_DATA: data, WING_TRAINER_EVAL: code, ...env }, encoding: 'utf8', timeout: 90_000 })
  const line = /^EVAL (.*)$/m.exec(r.stdout ?? '')
  if (!line) throw new Error(`no result: ${(r.stderr || r.stdout || '').slice(-500)}`)
  return JSON.parse(line[1])
}
const ready = `const w = (ms) => new Promise((r) => setTimeout(r, ms)); for (let i = 0; i < 100 && !(window.app && window.app.engine); i++) await w(100); await w(600);`

// The user had opened a snapshot file earlier (the dialog is replaced by writing what it would have remembered), in a window of a size they chose.
writeFileSync(join(data, 'session.json'), JSON.stringify({ window: { bounds: { x: 40, y: 50, width: 1234, height: 777 }, maximized: false }, dirs: { snapshot: root, recording: '', audio: '' }, snapshotPath: snap, state: null }))

// First run: it opens that file, and the user works
const first = run(`(async () => { ${ready}
  const q = (s) => document.querySelector(s)
  const out = { path: window.app.snapshotPath, name: window.app.sourceName, inner: [innerWidth, innerHeight] }
  const cur = window.app.current
  const c13 = cur.channels.find((c) => c.id === 13)
  // work: a fader, a knob-sized change through the model, a different channel selected, a channel moved, the Routing tab, a copy
  q('#bank .strip:nth-child(6) input.fader').value = '300'; q('#bank .strip:nth-child(6) input.fader').dispatchEvent(new Event('input', { bubbles: true }))
  const fader13 = window.app.current.channels.find((c) => c.id === 13).fader
  window.app.current.channels.find((c) => c.id === 14).gate.attack = 33
  document.querySelectorAll('#bank .strip')[6].click(); await w(200)
  ;[...document.querySelectorAll('button')].find((b) => b.textContent.startsWith('COPY TO A NEW INPUT')).click(); await w(200)
  ;[...document.querySelectorAll('#dlg button')].find((b) => b.textContent === 'COPY').click(); await w(800)
  document.querySelectorAll('.views .tab')[1].click(); await w(300)
  await w(1500) // the remembering waits half a second after the last change
  return { ...out, fader13, selected: window.app.state.selected, copies: window.app.current.channels.filter((c) => c.copyOf).length, order: window.app.state.order }
})()`)

const session1 = JSON.parse(readFileSync(join(data, 'session.json'), 'utf8'))

// Second run: nothing is done by hand; everything must be as it was left
const second = run(`(async () => { ${ready}
  const cur = window.app.current
  return { path: window.app.snapshotPath, name: window.app.sourceName, state: window.app.state, attack14: cur.channels.find((c) => c.id === 14).gate.attack, fader13: cur.channels.find((c) => c.id === 13).fader, copies: cur.channels.filter((c) => c.copyOf).length, exported: window.app.exportText(), routingShown: !document.getElementById('routing').hidden, outer: [outerWidth, outerHeight], status: document.getElementById('msg').textContent }
})()`)

// A snapshot file that has gone is not a reason to fail: the sample opens
rmSync(snap)
const third = run(`(async () => { ${ready} return { path: window.app.snapshotPath, name: window.app.sourceName, channels: window.app.current.channels.length } })()`)

// The window: a size that is off every screen must not be used
writeFileSync(join(data, 'session.json'), JSON.stringify({ window: { bounds: { x: 90000, y: 90000, width: 1200, height: 800 }, maximized: false }, dirs: { snapshot: '', recording: '', audio: '' }, snapshotPath: '', state: null }))
const fourth = run(`(async () => { ${ready} return { ok: innerWidth > 300 } })()`)

const j = JSON.stringify
const checks = [
  ['the first run opens the snapshot file that was open last time, not the sample', first.path === snap && first.name === 'my setup.snap', j([first.path, first.name])],
  ['the window comes back in the size the user left it', Math.abs(first.inner[0] - 1234) < 30 && Math.abs(first.inner[1] - 777) < 80, j(first.inner)],
  ['the session file records the snapshot, the folder of the snapshot dialog and the work state', session1.snapshotPath === snap && session1.state && session1.state.v === 1, j({ path: session1.snapshotPath, v: session1.state?.v })],
  ['the second run opens the same file', second.path === snap && second.name === 'my setup.snap', j([second.path, second.name])],
  ['the edits are still there: a fader, a gate attack, a copied channel', second.fader13 === first.fader13 && second.attack14 === 33 && second.copies === 1, j([second.fader13, second.attack14, second.copies])],
  ['the selection, the open tab and the order of the faders come back', second.state.selected === first.selected && second.routingShown && j(second.state.order) === j(first.order) && second.state.view === 'routing', j(second.state)],
  ['the app says it is back where it was left', /Back where you left off/.test(second.status), second.status],
  ['the edited snapshot can be written out: the exported file holds the edits, the copy, and nothing else changed', (() => { try { const x = JSON.parse(second.exported); const o = JSON.parse(readFileSync(new URL('../fixtures/sample.snap.json', import.meta.url).pathname, 'utf8')); return x.ae_data.ch['14'].gate.att === 33 && x.ae_data.ch['4'].name === 'SINGER 2 copy' && JSON.stringify(x.ae_data.ch['15']) === JSON.stringify(o.ae_data.ch['15']) && JSON.stringify(x.ae_data.bus) === JSON.stringify(o.ae_data.bus) } catch { return false } })(), ''],
  ['a snapshot file that has gone does not stop the app: the sample opens', third.path === '' && third.name === 'sample setup' && third.channels === 15, j(third)],
  ['a window position that is off every screen is not used', fourth.ok === true, j(fourth)],
]
let failed = 0
for (const [name, ok, detail] of checks) {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}
console.log(`\n${checks.length - failed}/${checks.length} session checks passed`)
process.exit(failed ? 1 : 0)
