// End-to-end check of the sound: the real app page renders the sample setup offline (no speakers needed) and the output is measured.
// A fader, mute, send, gate, compressor, EQ and solo must each change the sound the way the console's would. Needs a display for Electron.
import { spawnSync } from 'node:child_process'
import { ensureElectron } from './electron-path.mjs'

const electronPath = await ensureElectron()

const scenario = `(async () => {
  const w = (ms) => new Promise((r) => setTimeout(r, ms))
  for (let i = 0; i < 100 && !(window.app && window.app.engine); i++) await w(100)
  const { Engine, testSignal, base } = window.app
  const RATE = 48000
  const db = (rms) => (rms < 1e-7 ? -140 : 20 * Math.log10(rms))
  /** Renders 3 s of the setup after "mutate" changed it, and returns the level (RMS, dB) of what is listened to, after the first second. */
  const render = async (mutate, opts = {}) => {
    const snap = structuredClone(base)
    snap.channels.forEach((c) => { c.mute = true })
    mutate(snap)
    const ctx = new OfflineAudioContext(2, RATE * 3, RATE)
    const e = await Engine.create(ctx)
    e.build(snap)
    for (const c of snap.channels) if (c.hasSource) e.setBuffer(c.id, testSignal(ctx, c.id))
    if (opts.solo) e.setSolo(new Set(opts.solo), snap)
    e.listen(opts.listen || { kind: 'main', id: 1 })
    e.start()
    const out = await ctx.startRendering()
    let sum = 0, n = 0
    for (let ch = 0; ch < 2; ch++) { const d = out.getChannelData(ch); for (let i = RATE; i < d.length; i++) { sum += d[i] * d[i]; n++ } }
    return db(Math.sqrt(sum / n))
  }
  /** One channel alone on main 1 at 0 dB with no processing, then "mutate". */
  const alone = (id, mutate = () => {}) => (snap) => {
    const c = snap.channels.find((x) => x.id === id)
    c.mute = false; c.fader = 0; c.trim = 0; c.pan = 0
    c.gate.on = false; c.comp.on = false; c.eq.on = false; c.filters.lowCut.on = false; c.filters.highCut.on = false
    c.mains.forEach((m) => { m.on = m.main === 1; m.level = 0 })
    c.sends.forEach((s) => { s.on = false })
    snap.mains.forEach((m) => { m.mute = false; m.fader = 0 })
    mutate(c, snap)
  }
  const r = {}
  r.silent = await render(() => {})
  r.one = await render(alone(13))
  r.minus6 = await render(alone(13, (c) => { c.fader = -6 }))
  r.off = await render(alone(13, (c) => { c.fader = -144 }))
  r.muted = await render(alone(13, (c) => { c.mute = true }))
  r.gateOn = await render(alone(13, (c) => { c.gate.on = true; c.gate.threshold = -4; c.gate.range = 60; c.gate.attack = 1; c.gate.release = 20; c.gate.hold = 1 }))
  r.compOn = await render(alone(13, (c) => { c.comp.on = true; c.comp.model = 'COMP'; c.comp.threshold = -40; c.comp.ratio = 10; c.comp.makeup = 0; c.comp.attack = 1 }))
  r.lowCut = await render(alone(13, (c) => { c.filters.lowCut.on = true; c.filters.lowCut.freq = 2000 }))
  r.eqCut = await render(alone(13, (c) => { c.eq.on = true; c.eq.bands[0].gain = -15; c.eq.bands[0].freq = 300; c.eq.bands[0].q = 0.5; c.eq.low.gain = -15; c.eq.low.freq = 400 }))
  r.panLeft = await render(alone(13, (c) => { c.pan = -100 }))
  // A bus: the channel sends to STREAM (bus 4) and is not on the main
  const streamId = base.buses.find((b) => b.name === 'STREAM').id
  const toBus = (level, on = true, pre = false) => alone(13, (c) => { c.mains.forEach((m) => { m.on = false }); const s = c.sends.find((x) => x.bus === streamId); s.on = on; s.level = level; s.pre = pre })
  const busFaderZero = (snap) => { snap.buses.forEach((b) => { b.mute = false; b.fader = 0 }) }
  r.mainEmpty = await render(toBus(0))
  r.busLoud = await render((s) => { toBus(0)(s); busFaderZero(s) }, { listen: { kind: 'bus', id: streamId } })
  r.busQuiet = await render((s) => { toBus(-12)(s); busFaderZero(s) }, { listen: { kind: 'bus', id: streamId } })
  r.busOffSend = await render((s) => { toBus(0, false)(s); busFaderZero(s) }, { listen: { kind: 'bus', id: streamId } })
  r.preSendMutedFader = await render((s) => { toBus(0, true, true)(s); busFaderZero(s); s.channels.find((c) => c.id === 13).fader = -144 }, { listen: { kind: 'bus', id: streamId } })
  // Solo: channel 14 plays on the main; soloing channel 13 (muted on the main) is still heard
  r.soloHeard = await render((s) => { alone(14)(s); alone(13, (c) => { c.mute = false })(s); s.channels.find((x) => x.id === 14).fader = -144 }, { solo: [13] })
  // Matrix: STREAM bus -> matrix 1 ("HALL SPEAKERS")
  r.matrix = await render((s) => { toBus(0)(s); busFaderZero(s); s.matrices.forEach((m) => { m.mute = false; m.fader = 0 }); s.buses.find((b) => b.id === streamId).matrix.forEach((m) => { m.on = true; m.level = 0 }) }, { listen: { kind: 'matrix', id: 1 } })
  return r
})()`

const run = spawnSync(electronPath, ['.'], { env: { ...process.env, WING_TRAINER_EVAL: scenario }, encoding: 'utf8', timeout: 180_000 })
const line = /^EVAL (.*)$/m.exec(run.stdout ?? '')
if (!line) {
  console.error('The sound check did not report a result.', run.status, (run.stderr || '').slice(-800), (run.stdout || '').slice(-800))
  process.exit(1)
}
const r = JSON.parse(line[1])
const f = (v) => `${Number(v).toFixed(1)} dB`
const checks = [
  ['with every channel muted the output is silent', r.silent < -100, f(r.silent)],
  ['one channel at 0 dB makes sound', r.one > -50, f(r.one)],
  ['a fader at -6 dB is 6 dB quieter', Math.abs(r.one - 6 - r.minus6) < 0.7, `${f(r.one)} -> ${f(r.minus6)}`],
  ['a fader all the way down is silent', r.off < -100, f(r.off)],
  ['mute silences the channel', r.muted < -100, f(r.muted)],
  ['a closed gate takes the level down by a lot', r.gateOn < r.one - 6, `${f(r.one)} -> ${f(r.gateOn)}`],
  ['a compressor with a low threshold reduces the level (no make-up)', r.compOn < r.one - 3, `${f(r.one)} -> ${f(r.compOn)}`],
  ['a low cut at 2 kHz removes most of the energy of pink noise (about 5 dB)', r.lowCut < r.one - 3, `${f(r.one)} -> ${f(r.lowCut)}`],
  ['cutting the low EQ bands lowers the level', r.eqCut < r.one - 3, `${f(r.one)} -> ${f(r.eqCut)}`],
  ['panned hard left the sound is still there (a mono channel at -3 dB per side, or full on one)', r.panLeft > -50, f(r.panLeft)],
  ['a channel that only sends to a bus is not on the main', r.mainEmpty < -100, f(r.mainEmpty)],
  ['listening to the bus, the send is heard', r.busLoud > -50, f(r.busLoud)],
  ['a send at -12 dB is 12 dB quieter', Math.abs(r.busLoud - 12 - r.busQuiet) < 0.7, `${f(r.busLoud)} -> ${f(r.busQuiet)}`],
  ['a send that is off is silent', r.busOffSend < -100, f(r.busOffSend)],
  ['a pre-fader send is not affected by the channel fader', r.preSendMutedFader > -50, f(r.preSendMutedFader)],
  ['solo plays the soloed channel whatever the mix does', r.soloHeard > -50, f(r.soloHeard)],
  ['the matrix carries what the bus carries', r.matrix > -50, f(r.matrix)],
]
let failed = 0
for (const [name, ok, detail] of checks) {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (${detail})`)
}
console.log(`\n${checks.length - failed}/${checks.length} sound checks passed`)
process.exit(failed ? 1 : 0)
