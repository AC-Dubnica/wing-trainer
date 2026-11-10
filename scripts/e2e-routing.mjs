// End-to-end check of the Routing tab: the tables keep their place when something is changed, and connections are made and removed in
// the diagram with one key: ⌘-click connects, or disconnects when they are already connected (also on a line). Needs a display.
import { spawnSync } from 'node:child_process'
import { ensureElectron } from './electron-path.mjs'

const electronPath = await ensureElectron()
const scenario = `(async () => {
  const w = (ms) => new Promise((r) => setTimeout(r, ms))
  for (let i = 0; i < 100 && !(window.app && window.app.engine); i++) await w(100)
  const q = (s) => document.querySelector(s)
  const qa = (s) => [...document.querySelectorAll(s)]
  const node = (id) => qa('.fnode').find((n) => n.dataset.id === id)
  const click = (el, opts = {}) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, ...opts }))
  const cur = () => window.app.current
  const r = {}
  qa('.views .tab')[1].click(); await w(500)

  // 1. Changing a table must not scroll it back to the top
  const right = q('.rright')
  right.scrollTop = 400
  const before = right.scrollTop
  const box = q('input[aria-label="Input port of SINGER 5"]')
  box.value = '12'; box.dispatchEvent(new Event('change')); await w(500)
  r.scroll = { before, after: q('.rright').scrollTop }
  r.inputChanged = cur().channels.find((c) => c.name === 'SINGER 5').source.in

  // 2. ⌘-click connects: select SINGER 1 (ch 13), ⌘-click the input C 12
  click(node('ch:13')); await w(200)
  click(node('in:C:12'), { metaKey: true, ctrlKey: true }); await w(400)
  // the channel listened to C 2: giving it another input asks first
  r.askedInput = document.getElementById('dlg').open ? document.getElementById('dlg').textContent : ''
  qa('#dlg button').find((b) => b.textContent === 'REPLACE').click(); await w(400)
  r.connectedInput = cur().channels.find((c) => c.id === 13).source
  r.say = document.getElementById('msg').textContent

  // ⌘-click a bus and a main from a channel
  const stream = cur().buses.find((b) => b.name === 'STREAM').id
  click(node('ch:20')); await w(200)
  click(node('main:1'), { metaKey: true, ctrlKey: true }); await w(300)
  r.cajonToMain = cur().channels.find((c) => c.id === 20).mains.find((m) => m.main === 1).on

  // 3. ⌘-click on two things that are already connected disconnects them: the send of ch 14 to STREAM
  click(node('ch:14')); await w(200)
  click(node('bus:' + stream), { metaKey: true, ctrlKey: true }); await w(300)
  r.sendRemoved = !cur().channels.find((c) => c.id === 14).sends.find((s) => s.bus === stream).on

  // ⌘-click on a line: ch 15 -> PA
  const hits = qa('.flowhit')
  const line = hits.find((h) => (h.querySelector('title')?.textContent ?? '').startsWith('SINGER 3 → PA'))
  r.lineFound = !!line
  if (line) { line.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true, ctrlKey: true })); await w(300) }
  r.lineRemoved = !cur().channels.find((c) => c.name === 'SINGER 3').mains.find((m) => m.main === 1).on
  // ... and ⌘-click again on the two connects them once more (the same gesture, the other way)
  click(node('ch:15')); await w(200)
  click(node('main:1'), { metaKey: true, ctrlKey: true }); await w(300)
  r.reconnected = cur().channels.find((c) => c.name === 'SINGER 3').mains.find((m) => m.main === 1).on

  // 4. An output patched by connecting a main to it; nonsense is refused with a message
  // C 7 carries main 1 now: connecting main 2 asks first; CANCEL changes nothing, REPLACE does
  const btn = (t) => qa('#dlg button').find((b) => b.textContent === t)
  click(node('main:2')); await w(200)
  click(node('out:C:7'), { metaKey: true, ctrlKey: true }); await w(400)
  r.asked = document.getElementById('dlg').open ? document.getElementById('dlg').textContent : ''
  btn('CANCEL').click(); await w(300)
  r.afterCancel = cur().outputs.find((o) => o.grp === 'C' && o.port === 7).source
  click(node('out:C:7'), { metaKey: true, ctrlKey: true }); await w(400)
  btn('REPLACE').click(); await w(400)
  r.outputPatched = cur().outputs.find((o) => o.grp === 'C' && o.port === 7).source
  click(node('ch:13')); await w(200)
  click(node('ch:14'), { metaKey: true, ctrlKey: true }); await w(300)
  r.refused = document.getElementById('msg').textContent

  // 4b. Real clicks (made by the browser engine, with the key really held), not a script's imitation
  const centre = (el) => { const b = el.getBoundingClientRect(); return [Math.round(b.left + b.width / 2), Math.round(b.top + b.height / 2)] }
  const real = async (id, mods = []) => { node(id).scrollIntoView({ block: 'center' }); await w(150); const [x, y] = centre(node(id)); await window.trainer.testClick(x, y, mods); await w(450) }
  const onMain = () => cur().channels.find((c) => c.id === 22).mains.find((m) => m.main === 1).on
  const start = onMain()
  await real('ch:22'); await real('main:1', ['meta'])
  r.real = { start, afterCmd: onMain() }
  await real('main:1', ['meta'])
  r.real.afterCmdAgain = onMain()
  await real('main:1', ['alt'])
  r.real.afterAlt = onMain()
  r.real.say = document.getElementById('msg').textContent
  // with nothing selected the key click says what to do
  await real('ch:22'); // deselect (it was selected)
  await real('ch:21', ['meta'])
  r.real.noSelection = document.getElementById('msg').textContent

  // 5. They show in the list of changes
  r.changes = qa('.flat').find((b) => b.textContent.startsWith('CHANGES')).textContent
  return r
})()`

const run = spawnSync(electronPath, ['.'], { env: { ...process.env, WING_TRAINER_EVAL: scenario }, encoding: 'utf8', timeout: 120_000 })
const line = /^EVAL (.*)$/m.exec(run.stdout ?? '')
if (!line) {
  console.error('The routing scenario did not report a result.', (run.stderr || run.stdout || '').slice(-600))
  process.exit(1)
}
const r = JSON.parse(line[1])
const j = JSON.stringify
const checks = [
  ['changing an input in the table keeps the table where it was scrolled', r.scroll.before > 100 && Math.abs(r.scroll.after - r.scroll.before) < 5, j(r.scroll)],
  ['the input was changed', r.inputChanged === 12, String(r.inputChanged)],
  ['⌘-click on another item connects: the channel now takes that input', j(r.connectedInput) === j({ grp: 'C', in: 12 }), j(r.connectedInput)],
  ['giving a channel another input asks first and says which input it stops listening to', /SINGER 1 takes input C 2 now/.test(r.askedInput), r.askedInput.slice(0, 160)],
  ['and it says what it did', /now takes C 12/.test(r.say), r.say],
  ['a channel is connected to a main', r.cajonToMain === true, String(r.cajonToMain)],
  ['⌘-click on two connected items disconnects them: the send is off', r.sendRemoved === true, String(r.sendRemoved)],
  ['⌘-click on a line removes that connection', r.lineFound && r.lineRemoved, j([r.lineFound, r.lineRemoved])],
  ['⌘-click on them again connects them once more', r.reconnected === true, String(r.reconnected)],
  ['connecting something to an output that carries something else asks first, and says what is lost', /Replace the connection\?/.test(r.asked) && /carries main PA left now/.test(r.asked) && /PA left will no longer go to output C 7/.test(r.asked), r.asked.slice(0, 200)],
  ['CANCEL leaves the output as it was', j(r.afterCancel) === j({ grp: 'MAIN', in: 1 }), j(r.afterCancel)],
  ['an output is patched by connecting a main to it (after REPLACE)', j(r.outputPatched) === j({ grp: 'MAIN', in: 3 }), j(r.outputPatched)],
  ['two things that cannot be connected are refused, with the reason', /same kind/.test(r.refused), r.refused],
  ['a real ⌘-click connects, and another disconnects (not only an imitated one)', r.real.start === true && r.real.afterCmd === false && r.real.afterCmdAgain === true, j(r.real)],
  ['⌥ does the same', r.real.afterAlt === false, j(r.real)],
  ['⌘-click with nothing selected says what to do instead of doing nothing', /First select an item/.test(r.real.noSelection), r.real.noSelection],
  ['the connections show in the list of changes', /CHANGES\d+/.test(r.changes), r.changes],
]
let failed = 0
for (const [name, ok, detail] of checks) {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}
console.log(`\n${checks.length - failed}/${checks.length} routing checks passed`)
process.exit(failed ? 1 : 0)
