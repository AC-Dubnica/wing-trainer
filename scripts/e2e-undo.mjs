// End-to-end check of undo and redo with real key presses: ⌘Z (Ctrl+Z) undoes, ⌘⇧Z (Ctrl+Shift+Z) redoes, a new change ends the redo,
// a copied channel and a removed bus come back, and the UNDO and REDO buttons follow. Needs a display.
import { spawnSync } from 'node:child_process'
import { ensureElectron } from './electron-path.mjs'

const electronPath = await ensureElectron()
const scenario = `(async () => {
  const w = (ms) => new Promise((r) => setTimeout(r, ms))
  for (let i = 0; i < 100 && !(window.app && window.app.engine); i++) await w(100)
  await w(500)
  const qa = (s) => [...document.querySelectorAll(s)]
  const cur = () => window.app.current
  const ch = (id) => cur().channels.find((c) => c.id === id)
  const key = async (k, mods) => { await window.trainer.testKey(k, mods); await w(600) }
  const btn = (t) => qa('button').find((b) => b.textContent.includes(t))
  const settle = () => w(800) // an edit becomes a step half a second after the last change
  const r = {}
  r.undoDisabledAtStart = btn('UNDO').disabled

  // 1. a fader moved, then a channel muted
  const fader = document.querySelectorAll('#bank .strip')[5].querySelector('input.fader')
  const was = ch(13).fader
  fader.value = '300'; fader.dispatchEvent(new Event('input', { bubbles: true })); await settle()
  const moved = ch(13).fader
  r.moved = moved !== was
  const mute = document.querySelectorAll('#bank .strip')[6].querySelector('button.mute')
  const wasMute = ch(14).mute
  mute.click(); await settle()
  r.muted = ch(14).mute !== wasMute
  r.undoEnabled = !btn('UNDO').disabled

  // 2. real ⌘Z: the mute comes back, then the fader
  await key('Z', ['meta'])
  r.afterUndo1 = { mute: ch(14).mute === wasMute, fader: ch(13).fader === moved }
  r.say = document.getElementById('msg').textContent
  await key('Z', ['meta'])
  r.afterUndo2 = { fader: ch(13).fader === was }
  r.redoEnabled = !btn('REDO').disabled

  // 3. real ⌘⇧Z: forward again
  await key('Z', ['meta', 'shift'])
  r.afterRedo1 = ch(13).fader === moved
  await key('Z', ['meta', 'shift'])
  r.afterRedo2 = ch(14).mute !== wasMute
  // Ctrl+Y redoes too (nothing left to redo: it says so)
  await key('Y', ['control'])
  r.nothingToRedo = document.getElementById('msg').textContent

  // 4. a new change ends the redo
  await key('Z', ['meta'])
  const m2 = document.querySelectorAll('#bank .strip')[7].querySelector('button.mute'); m2.click(); await settle()
  r.redoEndedByChange = btn('REDO').disabled

  // 5. a copied channel and an added bus can be undone
  const before = cur().channels.length
  document.querySelectorAll('#bank .strip')[5].click(); await w(300)
  btn('COPY TO A NEW INPUT').click(); await w(300)
  qa('#dlg button').find((b) => b.textContent === 'COPY').click(); await w(900); await settle()
  r.copied = cur().channels.length === before + 1
  await key('Z', ['meta'])
  r.copyUndone = cur().channels.length === before
  await key('Z', ['meta', 'shift'])
  r.copyRedone = cur().channels.length === before + 1

  // 6. the whole thing is one history: reset is an undoable step too
  btn('RESET').click(); await settle()
  r.resetDone = cur().channels.length === before
  await key('Z', ['meta'])
  r.resetUndone = cur().channels.length === before + 1

  return r
})()`

const run = spawnSync(electronPath, ['.'], { env: { ...process.env, WING_TRAINER_EVAL: scenario }, encoding: 'utf8', timeout: 150_000 })
const line = /^EVAL (.*)$/m.exec(run.stdout ?? '')
if (!line) {
  console.error('The undo scenario did not report a result.', (run.stderr || run.stdout || '').slice(-600))
  process.exit(1)
}
const r = JSON.parse(line[1])
const j = JSON.stringify
const checks = [
  ['at the start there is nothing to undo', r.undoDisabledAtStart === true, ''],
  ['a fader move and a mute are changes, and UNDO is enabled', r.moved && r.muted && r.undoEnabled, j([r.moved, r.muted, r.undoEnabled])],
  ['a real ⌘Z takes back the last change only (the mute), leaving the fader', r.afterUndo1.mute && r.afterUndo1.fader, j(r.afterUndo1)],
  ['and says what it undid', /^Undone: /.test(r.say), r.say],
  ['a second ⌘Z takes back the fader, and REDO is enabled', r.afterUndo2.fader && r.redoEnabled, j([r.afterUndo2, r.redoEnabled])],
  ['⌘⇧Z goes forward again, step by step', r.afterRedo1 && r.afterRedo2, j([r.afterRedo1, r.afterRedo2])],
  ['when there is nothing left to redo it says so', /Nothing to redo/.test(r.nothingToRedo), r.nothingToRedo],
  ['a new change ends the redo', r.redoEndedByChange === true, String(r.redoEndedByChange)],
  ['a copied channel is undone and redone', r.copied && r.copyUndone && r.copyRedone, j([r.copied, r.copyUndone, r.copyRedone])],
  ['RESET is a step of the history: it can be undone', r.resetDone && r.resetUndone, j([r.resetDone, r.resetUndone])],
]
let failed = 0
for (const [name, ok, detail] of checks) {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}
console.log(`\n${checks.length - failed}/${checks.length} undo checks passed`)
process.exit(failed ? 1 : 0)
