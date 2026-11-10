import sampleJson from '../../fixtures/sample.snap.json'
import type { TrainerApi } from '../preload/index'
import { checkSnapshot, type Finding } from '../shared/checks'
import { describeChange, diffSnapshots } from '../shared/diff'
import type { Channel, Snapshot } from '../shared/model'
import { OFF_DB } from '../shared/model'
import { mapTracks } from '../shared/multitrack'
import { parseSnapshot } from '../shared/snapshot'
import { Engine, testSignal, type Listen } from './engine'

declare global { interface Window { trainer: TrainerApi; app: unknown } }

function el<T extends HTMLElement = HTMLElement>(tag: string, props: Partial<T> & { class?: string } = {}, ...kids: (Node | string)[]): T {
  const { class: cls, ...rest } = props
  const e = Object.assign(document.createElement(tag) as T, rest)
  if (cls) e.className = cls
  e.append(...kids)
  return e
}
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T

// --- state ---------------------------------------------------------------------------------------------------------------

let base: Snapshot
let cur: Snapshot
let sourceName = 'sample setup'
let engine: Engine | null = null
let ctx: AudioContext | null = null
let selected = 0
let tab: 'processing' | 'sends' | 'notes' = 'processing'
let listen: Listen = { kind: 'main', id: 1 }
const soloed = new Set<number>()
let recording = ''
const stripUi = new Map<number, { root: HTMLElement; fader: HTMLInputElement; db: HTMLElement; mute: HTMLButtonElement; solo: HTMLButtonElement; meter: HTMLElement; gr: HTMLElement }>()

const FADER_MIN = -70
const FADER_MAX = 10
const dbText = (v: number): string => (v <= OFF_DB ? '-∞' : `${v > 0 ? '+' : ''}${v.toFixed(1)}`)
const faderToDb = (slider: number): number => (slider <= FADER_MIN + 0.1 ? -144 : slider)
const dbToFader = (db: number): number => (db <= OFF_DB ? FADER_MIN : Math.min(FADER_MAX, Math.max(FADER_MIN, db)))
const channel = (id = selected): Channel | undefined => cur.channels.find((c) => c.id === id)
const COLORS = ['#6b7280', '#ef4444', '#22c55e', '#eab308', '#3b82f6', '#a855f7', '#06b6d4', '#e5e7eb', '#9ca3af', '#f97316', '#84cc16', '#14b8a6', '#6366f1', '#ec4899', '#f43f5e', '#a3a3a3']

function status(text: string): void { $('status').textContent = text }

// --- engine --------------------------------------------------------------------------------------------------------------

async function ensureEngine(): Promise<Engine> {
  if (engine) return engine
  ctx = new AudioContext({ latencyHint: 'interactive' })
  engine = await Engine.create(ctx)
  return engine
}

async function rebuildEngine(): Promise<void> {
  const e = await ensureEngine()
  e.build(cur)
  for (const c of cur.channels) if (c.hasSource && !recording) e.setBuffer(c.id, testSignal(e.ctx, c.id))
  e.setSolo(soloed, cur)
  e.listen(listen)
}

function changed(): void {
  engine?.apply(cur)
  refreshTop()
}

// --- loading -------------------------------------------------------------------------------------------------------------

async function useSnapshot(snap: Snapshot, name: string): Promise<void> {
  base = snap
  cur = structuredClone(snap)
  sourceName = name
  recording = ''
  soloed.clear()
  selected = cur.channels.find((c) => c.hasSource)?.id ?? cur.channels[0]?.id ?? 0
  listen = { kind: 'main', id: cur.mains[0]?.id ?? 1 }
  buildStrips()
  buildTop()
  buildDetail()
  await rebuildEngine()
  status(`Loaded ${name}: ${cur.channels.length} channels, ${cur.buses.length} buses. Every channel plays a test signal until you open a recording.`)
}

async function openSnapshot(): Promise<void> {
  const f = await window.trainer.openSnapshot()
  if (!f) return
  try {
    await useSnapshot(parseSnapshot(JSON.parse(f.text)), f.name)
  } catch (e) {
    status(`Could not open ${f.name}: ${(e as Error).message}`)
  }
}

async function decode(path: string): Promise<AudioBuffer> {
  const e = await ensureEngine()
  return e.ctx.decodeAudioData(await window.trainer.readAudio(path))
}

async function openRecording(): Promise<void> {
  const r = await window.trainer.openRecordingFolder()
  if (!r) return
  const e = await ensureEngine()
  const mapping = mapTracks(cur, r.files.map((f) => f.name))
  if (!mapping.assigned.length) { status(`None of the ${r.files.length} files could be placed on a channel. Name the tracks like "Track 03.wav": the number is the console's USB recorder track.`); return }
  status(`Reading ${mapping.assigned.length} tracks...`)
  recording = r.dir
  for (const c of cur.channels) e.setBuffer(c.id, null)
  const byName = new Map(r.files.map((f) => [f.name, f]))
  let failed = 0
  for (const a of mapping.assigned) {
    try {
      const buf = await decode(byName.get(a.file)!.path)
      for (const id of a.channels) e.setBuffer(id, buf)
    } catch (err) {
      failed++
      status(`Could not read ${a.file}: ${(err as Error).message}`)
    }
  }
  if (e.playing) e.start()
  const names = (ids: number[]) => ids.map((id) => channel(id)?.name ?? id).join(', ')
  status(`Recording: ${mapping.assigned.length - failed} tracks placed (${mapping.assigned.map((a) => `${a.track} → ${names(a.channels)}`).join('; ')})${mapping.unmatched.length ? `. Not placed: ${mapping.unmatched.join(', ')}` : ''}.`)
  refreshTop()
}

async function useTestSignals(): Promise<void> {
  recording = ''
  await rebuildEngine()
  refreshTop()
  status('Every channel plays a test signal again.')
}

async function openFileOnChannel(): Promise<void> {
  const c = channel()
  if (!c) return
  const f = await window.trainer.openAudioFile()
  if (!f) return
  try {
    const e = await ensureEngine()
    e.setBuffer(c.id, await decode(f.path))
    recording = recording || '(single files)'
    if (e.playing) e.start()
    status(`${f.name} plays on channel ${c.id} ${c.name}.`)
  } catch (err) {
    status(`Could not read ${f.name}: ${(err as Error).message}`)
  }
}

// --- strips --------------------------------------------------------------------------------------------------------------

function buildStrips(): void {
  stripUi.clear()
  $('strips').replaceChildren(...cur.channels.map((c) => {
    const fader = el<HTMLInputElement>('input', { type: 'range', class: 'fader', min: String(FADER_MIN), max: String(FADER_MAX), step: '0.5', value: String(dbToFader(c.fader)) })
    fader.setAttribute('aria-label', `Fader ${c.name}`)
    const db = el('div', { class: 'db', textContent: dbText(c.fader) })
    const mute = el<HTMLButtonElement>('button', { class: 'mute', textContent: 'M', title: 'Mute' })
    const solo = el<HTMLButtonElement>('button', { class: 'solo', textContent: 'S', title: 'Solo: listen to this channel alone' })
    const meter = el('i')
    const gr = el('div', { class: 'gr' })
    const root = el('div', { class: 'strip' },
      el('div', { class: 'bar' }), el('div', { class: 'nm', textContent: c.name || `Ch ${c.id}`, title: `Channel ${c.id} ${c.name}` }), el('div', { class: 'no', textContent: c.hasSource ? `${c.id} · ${c.source.grp}${c.source.in}` : `${c.id} · no input` }),
      gr, el('div', { class: 'fd' }, el('div', { class: 'vm' }, meter), fader), db, el('div', { class: 'ms' }, mute, solo))
    ;(root.querySelector('.bar') as HTMLElement).style.background = COLORS[c.color % COLORS.length]
    root.onclick = () => select(c.id)
    fader.oninput = () => { c.fader = faderToDb(Number(fader.value)); db.textContent = dbText(c.fader); changed(); if (selected === c.id) buildDetail() }
    fader.onclick = (e) => e.stopPropagation()
    mute.onclick = (e) => { e.stopPropagation(); c.mute = !c.mute; changed(); refreshStrip(c.id) }
    solo.onclick = (e) => { e.stopPropagation(); if (soloed.has(c.id)) soloed.delete(c.id); else soloed.add(c.id); engine?.setSolo(soloed, cur); refreshStrip(c.id) }
    stripUi.set(c.id, { root, fader, db, mute, solo, meter, gr })
    refreshStrip(c.id)
    return root
  }))
}

function refreshStrip(id: number): void {
  const c = channel(id)
  const u = stripUi.get(id)
  if (!c || !u) return
  u.mute.classList.toggle('on', c.mute)
  u.solo.classList.toggle('on', soloed.has(id))
  u.root.classList.toggle('sel', id === selected)
  u.root.classList.toggle('silent', !c.hasSource || c.mute)
  u.fader.value = String(dbToFader(c.fader))
  u.db.textContent = dbText(c.fader)
}

function select(id: number): void {
  const prev = selected
  selected = id
  refreshStrip(prev)
  refreshStrip(id)
  buildDetail()
}

// --- detail --------------------------------------------------------------------------------------------------------------

type Fmt = (v: number) => string
function slider(label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void, fmt: Fmt, log = false): HTMLElement {
  const value = el('div', { class: 'v', textContent: fmt(get()) })
  // Frequencies are felt in octaves: a logarithmic slider puts 100 Hz and 10 kHz where the ear expects them.
  const toPos = (v: number): number => (log ? (Math.log(Math.max(min, v) / min) / Math.log(max / min)) * 1000 : v)
  const fromPos = (p: number): number => (log ? min * (max / min) ** (p / 1000) : p)
  const input = el<HTMLInputElement>('input', { type: 'range', min: log ? '0' : String(min), max: log ? '1000' : String(max), step: log ? '1' : String(step), value: String(toPos(get())) })
  input.setAttribute('aria-label', label)
  input.oninput = () => { const v = fromPos(Number(input.value)); set(v); value.textContent = fmt(v); changed() }
  return el('div', { class: 'row' }, el('label', { textContent: label }), input, value)
}
function toggle(label: string, get: () => boolean, set: (v: boolean) => void): HTMLElement {
  const box = el<HTMLInputElement>('input', { type: 'checkbox', checked: get() })
  box.onchange = () => { set(box.checked); changed(); buildDetail() }
  return el('label', { class: 'hdr' }, box, el('b', { textContent: label }))
}
const db1: Fmt = (v) => `${v.toFixed(1)} dB`
const ms1: Fmt = (v) => `${Number(v.toFixed(1))} ms`
const hz1: Fmt = (v) => (v >= 1000 ? `${Number((v / 1000).toFixed(2))} kHz` : `${Math.round(v)} Hz`)
const num1: Fmt = (v) => String(Number(v.toFixed(2)))

function processingTab(c: Channel): HTMLElement {
  const eqBand = (name: string, b: { gain: number; freq: number; q: number }): HTMLElement[] => [
    slider(`${name} gain`, -15, 15, 0.1, () => b.gain, (v) => { b.gain = v }, db1),
    slider(`${name} freq`, 20, 20000, 1, () => b.freq, (v) => { b.freq = v }, hz1, true),
    slider(`${name} Q`, 0.3, 10, 0.1, () => b.q, (v) => { b.q = v }, num1),
  ]
  return el('div', { class: 'cols' },
    el('fieldset', {}, el('legend', { textContent: 'Input and filters' }),
      slider('Trim', -18, 18, 0.5, () => c.trim, (v) => { c.trim = v }, db1),
      toggle('Low cut', () => c.filters.lowCut.on, (v) => { c.filters.lowCut.on = v }),
      slider('Low cut freq', 20, 600, 1, () => c.filters.lowCut.freq, (v) => { c.filters.lowCut.freq = v }, hz1, true),
      toggle('High cut', () => c.filters.highCut.on, (v) => { c.filters.highCut.on = v }),
      slider('High cut freq', 1000, 20000, 10, () => c.filters.highCut.freq, (v) => { c.filters.highCut.freq = v }, hz1, true),
      slider('Pan', -100, 100, 1, () => c.pan, (v) => { c.pan = v }, (v) => (v === 0 ? 'center' : v < 0 ? `L ${-v}` : `R ${v}`))),
    el('fieldset', {}, el('legend', { textContent: 'Equalizer' }),
      toggle('EQ on', () => c.eq.on, (v) => { c.eq.on = v }),
      ...eqBand(c.eq.low.shelf ? 'Low shelf' : 'Low', c.eq.low), ...c.eq.bands.flatMap((b, i) => eqBand(`Band ${i + 1}`, b)), ...eqBand(c.eq.high.shelf ? 'High shelf' : 'High', c.eq.high)),
    el('div', {},
      el('fieldset', {}, el('legend', { textContent: 'Gate' }),
        toggle('Gate on', () => c.gate.on, (v) => { c.gate.on = v }),
        slider('Threshold', -80, 0, 0.5, () => c.gate.threshold, (v) => { c.gate.threshold = v }, db1),
        slider('Range', 3, 60, 0.5, () => c.gate.range, (v) => { c.gate.range = v }, db1),
        slider('Attack', 0, 200, 1, () => c.gate.attack, (v) => { c.gate.attack = v }, ms1),
        slider('Hold', 0, 500, 1, () => c.gate.hold, (v) => { c.gate.hold = v }, ms1),
        slider('Release', 5, 2000, 1, () => c.gate.release, (v) => { c.gate.release = v }, ms1)),
      Object.assign(el('fieldset', {}, el('legend', { textContent: `Compressor (${c.comp.model})` }),
        toggle('Compressor on', () => c.comp.on, (v) => { c.comp.on = v }),
        ...(c.comp.model === 'COMP' ? [] : [el('div', { class: 'dim', textContent: `The ${c.comp.model} model is not simulated: it lets the signal through.` })]),
        slider('Threshold', -60, 0, 0.5, () => c.comp.threshold, (v) => { c.comp.threshold = v }, db1),
        slider('Ratio', 1, 20, 0.1, () => c.comp.ratio, (v) => { c.comp.ratio = v }, (v) => `${num1(v)}:1`),
        slider('Knee', 0, 20, 1, () => c.comp.knee, (v) => { c.comp.knee = v }, db1),
        slider('Attack', 0.5, 200, 0.5, () => c.comp.attack, (v) => { c.comp.attack = v }, ms1),
        slider('Release', 10, 2000, 1, () => c.comp.release, (v) => { c.comp.release = v }, ms1),
        slider('Make-up gain', 0, 24, 0.5, () => c.comp.makeup, (v) => { c.comp.makeup = v }, db1)), { style: { marginTop: '12px' } })))
}

function sendsTab(c: Channel): HTMLElement {
  const rows = c.sends.map((s) => {
    const bus = cur.buses.find((b) => b.id === s.bus)
    if (!bus) return null
    const on = el<HTMLInputElement>('input', { type: 'checkbox', checked: s.on })
    on.onchange = () => { s.on = on.checked; changed() }
    const level = el('span', { class: 'v', textContent: dbText(s.level) })
    const input = el<HTMLInputElement>('input', { type: 'range', min: '-60', max: '10', step: '0.5', value: String(Math.max(-60, s.level)) })
    input.oninput = () => { s.level = Number(input.value) <= -59.9 ? -144 : Number(input.value); level.textContent = dbText(s.level); changed() }
    const pre = el<HTMLSelectElement>('select', {}, el<HTMLOptionElement>('option', { value: 'post', textContent: 'post-fader', selected: !s.pre }), el<HTMLOptionElement>('option', { value: 'pre', textContent: 'pre-fader', selected: s.pre }))
    pre.onchange = () => { s.pre = pre.value === 'pre'; void rebuildEngine() }
    return el('tr', {}, el('td', { textContent: `${bus.id} ${bus.name}` }), el('td', {}, on), el('td', {}, input), el('td', {}, level), el('td', {}, pre))
  }).filter((r): r is HTMLElement => r !== null)
  const mains = c.mains.map((m) => {
    const main = cur.mains.find((x) => x.id === m.main)
    if (!main) return null
    const on = el<HTMLInputElement>('input', { type: 'checkbox', checked: m.on })
    on.onchange = () => { m.on = on.checked; changed() }
    return el('tr', {}, el('td', { textContent: `Main ${main.id} ${main.name}` }), el('td', {}, on), el<HTMLTableCellElement>('td', { colSpan: 3, class: 'dim', textContent: `level ${dbText(m.level)} dB` }))
  }).filter((r): r is HTMLElement => r !== null)
  return el('table', {}, el('thead', {}, el('tr', {}, ...['Goes to', 'On', 'Level', '', 'Tap'].map((h) => el('th', { textContent: h })))), el('tbody', {}, ...mains, ...rows))
}

function notesTab(c: Channel): HTMLElement {
  const findings = checkSnapshot({ ...cur, channels: [c] })
  return el('div', {}, ...(findings.length ? findings.map(findingRow) : [el('div', { class: 'dim', textContent: 'Nothing to point out on this channel.' })]))
}
const findingRow = (f: Finding): HTMLElement => el('div', { class: `finding ${f.severity}`, textContent: f.text })

function buildDetail(): void {
  const c = channel()
  if (!c) { $('detail').replaceChildren(el('div', { class: 'dim', textContent: 'No channel selected.' })); return }
  const tabBtn = (id: typeof tab, label: string) => el<HTMLButtonElement>('button', { textContent: label, class: tab === id ? 'on' : '', onclick: () => { tab = id; buildDetail() } })
  const head = el('div', { class: 'tabs' }, el('h2', { textContent: `Channel ${c.id} ${c.name}` }), tabBtn('processing', 'Processing'), tabBtn('sends', 'Sends'), tabBtn('notes', 'Notes'),
    el('span', { class: 'grow' }), el<HTMLButtonElement>('button', { textContent: 'Play a file on this channel…', onclick: () => void openFileOnChannel() }))
  $('detail').replaceChildren(head, tab === 'processing' ? processingTab(c) : tab === 'sends' ? sendsTab(c) : notesTab(c))
}

// --- top bar -------------------------------------------------------------------------------------------------------------

function listenOptions(): { value: string; label: string }[] {
  return [
    ...cur.mains.map((m) => ({ value: `main:${m.id}`, label: `Main ${m.id} ${m.name}` })),
    ...cur.buses.map((b) => ({ value: `bus:${b.id}`, label: `Bus ${b.id} ${b.name}` })),
    ...cur.matrices.map((m) => ({ value: `matrix:${m.id}`, label: `Matrix ${m.id} ${m.name}` })),
  ]
}

let playBtn: HTMLButtonElement
let checksBtn: HTMLButtonElement
let changesBtn: HTMLButtonElement
let outMeter: HTMLElement

function buildTop(): void {
  playBtn = el<HTMLButtonElement>('button', { class: 'primary', textContent: '▶ Play', onclick: () => void togglePlay() })
  checksBtn = el<HTMLButtonElement>('button', { onclick: () => showChecks() })
  changesBtn = el<HTMLButtonElement>('button', { onclick: () => showChanges() })
  const select = el<HTMLSelectElement>('select', {}, ...listenOptions().map((o) => el<HTMLOptionElement>('option', { value: o.value, textContent: o.label, selected: o.value === `${listen.kind}:${listen.id}` })))
  select.setAttribute('aria-label', 'Listen to')
  select.onchange = () => { const [kind, id] = select.value.split(':'); listen = { kind: kind as Listen['kind'], id: Number(id) }; engine?.listen(listen) }
  outMeter = el('i')
  $('top').replaceChildren(
    el('h1', { textContent: 'WING Trainer' }),
    el<HTMLButtonElement>('button', { textContent: 'Open snapshot…', onclick: () => void openSnapshot() }),
    el<HTMLButtonElement>('button', { textContent: 'Open recording…', onclick: () => void openRecording() }),
    el<HTMLButtonElement>('button', { textContent: 'Test signals', title: 'Play a test signal on every channel again', onclick: () => void useTestSignals() }),
    el('span', { class: 'sep' }), playBtn,
    el('label', { class: 'dim', textContent: 'Listen to ' }, select), el('div', { class: 'outmeter' }, outMeter),
    el('span', { class: 'grow' }),
    el('span', { class: 'dim', id: 'src' }), checksBtn, changesBtn,
    el<HTMLButtonElement>('button', { textContent: 'Reset', title: 'Back to the snapshot as it was loaded', onclick: () => void reset() }))
  refreshTop()
}

function refreshTop(): void {
  const findings = checkSnapshot(cur).length
  const changes = diffSnapshots(base, cur).length
  checksBtn.replaceChildren('Checks', ...(findings ? [el('span', { class: 'badge', textContent: String(findings) })] : []))
  changesBtn.replaceChildren('Changes', ...(changes ? [el('span', { class: 'badge', textContent: String(changes) })] : []))
  $('src').textContent = `${sourceName}${recording ? ` · recording` : ' · test signals'}`
  playBtn.textContent = engine?.playing ? '■ Stop' : '▶ Play'
}

async function togglePlay(): Promise<void> {
  const e = await ensureEngine()
  if (ctx?.state === 'suspended') await ctx.resume()
  if (e.playing) e.stop()
  else e.start()
  refreshTop()
}

async function reset(): Promise<void> {
  cur = structuredClone(base)
  soloed.clear()
  buildStrips()
  buildDetail()
  await rebuildEngine()
  refreshTop()
  status('Back to the snapshot as it was loaded.')
}

// --- dialogs -------------------------------------------------------------------------------------------------------------

function dialog(title: string, body: HTMLElement, extra: HTMLElement[] = []): void {
  const dlg = $<HTMLDialogElement>('dlg')
  dlg.replaceChildren(el('h3', { textContent: title }), el('div', { class: 'body' }, body), el('div', { class: 'btns' }, ...extra, el<HTMLButtonElement>('button', { textContent: 'Close', onclick: () => dlg.close() })))
  dlg.showModal()
}

function showChecks(): void {
  const findings = checkSnapshot(cur)
  dialog('Checks', el('div', {}, ...(findings.length ? findings.map(findingRow) : [el('div', { class: 'dim', textContent: 'No problems found in the settings.' })])))
}

function showChanges(): void {
  const lines = diffSnapshots(base, cur).map(describeChange)
  const copy = el<HTMLButtonElement>('button', { textContent: 'Copy', onclick: () => void navigator.clipboard.writeText(lines.join('\n')) })
  dialog('What you changed', el('div', {}, el('p', { class: 'dim', textContent: 'The trainer does not write snapshots. Make these changes on the console to use them.' }), ...(lines.length ? lines.map((l) => el('div', { class: 'finding', textContent: l })) : [el('div', { class: 'dim', textContent: 'Nothing changed yet.' })])), lines.length ? [copy] : [])
}

// --- meters --------------------------------------------------------------------------------------------------------------

function tick(): void {
  if (engine) {
    const lv = engine.levels()
    for (const [id, u] of stripUi) {
      const l = lv.channels.get(id)
      if (!l) continue
      u.meter.style.height = `${Math.min(100, Math.max(0, ((l.peak + 60) / 60) * 100))}%`
      u.meter.style.background = l.peak > -3 ? 'var(--bad)' : l.peak > -12 ? 'var(--warn)' : 'var(--good)'
      u.gr.textContent = !engine.playing ? '' : [l.gate < -1 ? `G ${l.gate.toFixed(0)}` : '', l.comp < -1 ? `C ${l.comp.toFixed(0)}` : ''].filter(Boolean).join(' ')
    }
    const out = listen.kind === 'main' ? lv.mains : listen.kind === 'bus' ? lv.buses : lv.matrices
    const peak = out.get(listen.id) ?? -100
    outMeter.style.width = `${Math.min(100, Math.max(0, ((peak + 60) / 60) * 100))}%`
    outMeter.style.background = peak > -3 ? 'var(--bad)' : peak > -12 ? 'var(--warn)' : 'var(--good)'
  }
  requestAnimationFrame(tick)
}

// --- start ---------------------------------------------------------------------------------------------------------------

void (async () => {
  await useSnapshot(parseSnapshot(sampleJson), 'sample setup')
  requestAnimationFrame(tick)
})()

// For the end-to-end test.
window.app = { get engine() { return engine }, get current() { return cur }, get base() { return base }, rebuildEngine, ensureEngine, Engine, testSignal }
