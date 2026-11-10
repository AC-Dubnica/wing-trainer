// A session saved by an older version (its model lacks fields that later versions added) must not break the app: adding a matrix and
// connecting in the Routing tab must work on top of it. Needs a display.
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureElectron } from './electron-path.mjs'

const electronPath = await ensureElectron()
const root = join(process.env.E2E_OUT_DIR || tmpdir(), 'wing-trainer-e2e-oldstate')
rmSync(root, { recursive: true, force: true })
const data = join(root, 'data')
mkdirSync(data, { recursive: true })
const snap = join(root, 'my setup.snap')
copyFileSync(new URL('../fixtures/sample.snap.json', import.meta.url).pathname, snap)

const run = (code) => {
  const r = spawnSync(electronPath, ['.'], { env: { ...process.env, WING_TRAINER_USER_DATA: data, WING_TRAINER_EVAL: code }, encoding: 'utf8', timeout: 90_000 })
  const line = /^EVAL (.*)$/m.exec(r.stdout ?? '')
  if (!line) throw new Error(`no result: ${(r.stderr || r.stdout || '').slice(-500)}`)
  return JSON.parse(line[1])
}
const ready = `const w = (ms) => new Promise((r) => setTimeout(r, ms)); for (let i = 0; i < 100 && !(window.app && window.app.engine); i++) await w(100); await w(600);`

// Run 1 makes a session; then the file is changed to look like one an older version saved: mains and buses without their matrix sends
run(`(async () => { ${ready}
  document.querySelectorAll('#bank .strip')[0].click(); await w(1500); return 1 })()`)
const file = join(data, 'session.json')
const session = JSON.parse(readFileSync(file, 'utf8'))
for (const m of session.state.cur.mains) delete m.matrix
for (const b of session.state.cur.buses) delete b.matrix
// ... and from before stereo channels: the input ports have no mode and the channels no stereo field
for (const p of session.state.cur.inputs) delete p.mode
for (const c of session.state.cur.channels) delete c.stereo
writeFileSync(file, JSON.stringify(session))

const result = run(`(async () => { ${ready}
  const qa = (s) => [...document.querySelectorAll(s)]
  const out = { status: document.getElementById('msg').textContent }
  // add a matrix through the dialog
  const empty = document.querySelector('#outs .strip.empty')
  empty.click(); await w(300)
  const add = qa('#dlg button').find((b) => b.textContent === 'ADD')
  add.click(); await w(900)
  out.matrices = window.app.current.matrices.length
  // connect in the Routing tab with a real ⌘-click
  qa('.views .tab')[1].click(); await w(600)
  const node = (id) => qa('.fnode').find((n) => n.dataset.id === id)
  const centre = (el) => { const b = el.getBoundingClientRect(); return [Math.round(b.left + b.width / 2), Math.round(b.top + b.height / 2)] }
  const click = async (id, mods = []) => { node(id).scrollIntoView({ block: 'center' }); await w(150); const [x, y] = centre(node(id)); await window.trainer.testClick(x, y, mods); await w(450) }
  await click('ch:20'); await click('main:1', ['meta'])
  out.connected = window.app.current.channels.find((c) => c.id === 20).mains.find((m) => m.main === 1).on
  out.routingNodes = qa('.fnode').length
  // the piano is on the stereo pair C 9 and C 10: it must show as stereo although the saved model knew nothing of it
  qa('.views .tab')[0].click(); await w(400)
  out.pianoStrip = [...document.querySelectorAll('#bank .strip')].find((s) => s.textContent.includes('PIANO'))?.textContent ?? ''
  qa('.views .tab')[1].click(); await w(400)
  out.pairNode = qa('.fnode').map((n) => n.textContent).find((t) => t.includes('C 9+10')) ?? ''
  return out
})()`)

const j = JSON.stringify
const checks = [
  ['the app opens on a session saved by an older version', result.routingNodes > 10, j(result.status)],
  ['a matrix can be added on top of it (the ADD button works)', result.matrices === 2, j(result.matrices)],
  ['the piano still shows as stereo (ST on its strip, C 9+10 in the diagram) after an old session is restored', /ST/.test(result.pianoStrip) && /C9\+10/.test(result.pianoStrip) && /C 9\+10/.test(result.pairNode), JSON.stringify([result.pianoStrip.slice(0, 40), result.pairNode])],
  ['and a connection can be made in the Routing tab with ⌘-click', typeof result.connected === 'boolean', j(result.connected)],
]
let failed = 0
for (const [name, ok, detail] of checks) {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}
console.log(`\n${checks.length - failed}/${checks.length} old-session checks passed`)
process.exit(failed ? 1 : 0)
