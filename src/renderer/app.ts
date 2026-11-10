import sampleJson from '../../fixtures/sample.snap.json'
import type { TrainerApi } from '../preload/index'
import { checkSnapshot, type Finding } from '../shared/checks'
import { compCurve, eqCurve, gateCurve } from '../shared/curves'
import { describeChange, diffSnapshots } from '../shared/diff'
import type { Channel, Snapshot } from '../shared/model'
import { OFF_DB } from '../shared/model'
import { mapTracks } from '../shared/multitrack'
import { parseSnapshot } from '../shared/snapshot'
import { dbAt, FADER_MAX, FADER_MIN, posOf } from '../shared/fader'
import { Engine, testSignal, type Listen } from './engine'
import { createRouting } from './routing'

declare global { interface Window { trainer: TrainerApi; app: unknown } }

function el<T extends HTMLElement = HTMLElement>(tag: string, props: Partial<T> & { class?: string } = {}, ...kids: (Node | string)[]): T {
  const { class: cls, ...rest } = props
  const e = Object.assign(document.createElement(tag) as T, rest)
  if (cls) e.className = cls
  e.append(...kids)
  return e
}
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T
const sty = <T extends HTMLElement>(e: T, css: Partial<CSSStyleDeclaration>): T => { Object.assign(e.style, css); return e }

// --- state ---------------------------------------------------------------------------------------------------------------

let base: Snapshot
let cur: Snapshot
let sourceName = 'sample setup'
let engine: Engine | null = null
let ctx: AudioContext | null = null
let selected = 0
let layer: 'channels' | 'buses' = 'channels'
let view: 'console' | 'routing' = 'console'
/** Channel ids in the order of the faders. */
let order: number[] = []
let baseOrder: number[] = []
/** The decoded tracks of the open recording by file name, and single files played on one channel. */
const decoded = new Map<string, AudioBuffer>()
const singles = new Map<number, AudioBuffer>()
let redraw: (() => void)[] = []
let listen: Listen = { kind: 'main', id: 1 }
const soloed = new Set<number>()
let recording = ''
interface StripUi { root: HTMLElement; fader: HTMLInputElement; db: HTMLElement; mute: HTMLButtonElement; solo: HTMLButtonElement; meter: HTMLElement; gr: HTMLElement; chips: HTMLElement[] }
const stripUi = new Map<string, StripUi>()
/** Which console outputs have a strip: the key is kind and id, "ch:13", "bus:4", "main:1", "matrix:1". */
const keyOf = (kind: string, id: number): string => `${kind}:${id}`

const POS_MAX = 1000
const dbText = (v: number): string => (v <= OFF_DB ? '-∞' : `${v > 0 ? '+' : ''}${v.toFixed(1)}`)
/** The slider value (0 to POS_MAX) as a level in dB, rounded to 0.1; the bottom of the travel is "off". */
const faderToDb = (slider: number): number => (slider <= 2 ? -144 : Math.round(dbAt(slider / POS_MAX) * 10) / 10)
const dbToFader = (db: number): number => (db <= OFF_DB ? 0 : Math.round(posOf(db) * POS_MAX))
const channel = (id = selected): Channel | undefined => cur.channels.find((c) => c.id === id)
/** The console's 12 channel colours by number (0 = none). */
const COLORS = ['#6b7280', '#7e8fa6', '#3f8ae0', '#2a4fa8', '#28b8c0', '#3aa95a', '#8c9a2d', '#e8c630', '#ee8a27', '#d9402f', '#f0705a', '#e66aa8', '#a070c8']
const LIGHT = new Set([1, 4, 5, 7, 8, 10, 11, 12]) // colours that take dark text

function status(text: string): void { $('msg').textContent = text }

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
  if (decoded.size) assignRecording()
  else for (const c of cur.channels) if (c.hasSource) e.setBuffer(c.id, testSignal(e.ctx, c.id))
  for (const [id, buf] of singles) e.setBuffer(id, buf)
  e.setSolo(soloed, cur)
  e.listen(listen)
}

/** Puts the tracks of the open recording on the channels, as the snapshot's routing says (so a changed input or recorder patch moves a track to another fader). */
function assignRecording(): void {
  if (!engine || !decoded.size) return
  for (const c of cur.channels) engine.setBuffer(c.id, null)
  for (const a of mapTracks(cur, [...decoded.keys()]).assigned) for (const id of a.channels) engine.setBuffer(id, decoded.get(a.file)!)
  for (const [id, buf] of singles) engine.setBuffer(id, buf)
}

/** Called after every edit (it is defined with the screen, below). */
function changed(): void {
  afterEdit()
}

// --- loading -------------------------------------------------------------------------------------------------------------

async function useSnapshot(snap: Snapshot, name: string): Promise<void> {
  base = snap
  cur = structuredClone(snap)
  sourceName = name
  recording = ''
  decoded.clear()
  singles.clear()
  soloed.clear()
  order = cur.channels.map((c) => c.id)
  baseOrder = [...order]
  selected = cur.channels.find((c) => c.hasSource)?.id ?? cur.channels[0]?.id ?? 0
  listen = { kind: 'main', id: cur.mains[0]?.id ?? 1 }
  buildStrips()
  buildTop()
  buildDetail()
  routing.render()
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
  decoded.clear()
  const byName = new Map(r.files.map((f) => [f.name, f]))
  let failed = 0
  for (const a of mapping.assigned) {
    try {
      decoded.set(a.file, await decode(byName.get(a.file)!.path))
    } catch (err) {
      failed++
      status(`Could not read ${a.file}: ${(err as Error).message}`)
    }
  }
  assignRecording()
  if (e.playing) e.start()
  const names = (ids: number[]) => ids.map((id) => channel(id)?.name ?? id).join(', ')
  status(`Recording: ${mapping.assigned.length - failed} tracks placed (${mapping.assigned.map((a) => `${a.track} → ${names(a.channels)}`).join('; ')})${mapping.unmatched.length ? `. Not placed: ${mapping.unmatched.join(', ')}` : ''}.`)
  refreshTop()
}

async function useTestSignals(): Promise<void> {
  recording = ''
  decoded.clear()
  singles.clear()
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
    const buf = await decode(f.path)
    singles.set(c.id, buf)
    e.setBuffer(c.id, buf)
    recording = recording || '(single files)'
    if (e.playing) e.start()
    status(`${f.name} plays on channel ${c.id} ${c.name}.`)
  } catch (err) {
    status(`Could not read ${f.name}: ${(err as Error).message}`)
  }
}

// --- views ---------------------------------------------------------------------------------------------------------------

const routing = createRouting($('routing'), {
  snap: () => cur,
  order: () => order,
  move: (id, delta) => {
    const i = order.indexOf(id)
    const j = i + delta
    if (i < 0 || j < 0 || j >= order.length) return
    ;[order[i], order[j]] = [order[j], order[i]]
    buildStrips()
    refreshTop()
  },
  edited: () => {
    assignRecording()
    if (engine?.playing) engine.start()
    buildStrips()
    refreshAllStrips()
    refreshTop()
    if (channel()) buildDetail()
  },
  selectChannel: (id) => { selected = id; selectedOut = '' },
  colors: COLORS,
  lightColors: LIGHT,
})

function setView(v: typeof view): void {
  view = v
  $('consoleView').hidden = v !== 'console'
  $('routing').hidden = v !== 'routing'
  buildTop()
  if (v === 'routing') routing.render()
}

// --- strips --------------------------------------------------------------------------------------------------------------

/** What a strip needs to know about the thing it controls, so channels, buses, mains and matrices share one strip. */
interface Fader {
  kind: 'ch' | 'bus' | 'main' | 'matrix'
  id: number
  name: string
  color: number
  sub: string
  silent: boolean
  getFader(): number
  setFader(v: number): void
  getMute(): boolean
  setMute(v: boolean): void
  channel?: Channel
}

function faders(): { bank: Fader[]; out: Fader[] } {
  const ch = [...cur.channels].sort((x, y) => order.indexOf(x.id) - order.indexOf(y.id)).map((c): Fader => ({
    kind: 'ch', id: c.id, name: c.name || `Ch ${c.id}`, color: c.color, sub: c.hasSource ? `${c.source.grp}${c.source.in}` : 'no input', silent: !c.hasSource,
    getFader: () => c.fader, setFader: (v) => { c.fader = v }, getMute: () => c.mute, setMute: (v) => { c.mute = v }, channel: c,
  }))
  const bus = cur.buses.map((b): Fader => ({ kind: 'bus', id: b.id, name: b.name, color: 0, sub: '', silent: false, getFader: () => b.fader, setFader: (v) => { b.fader = v }, getMute: () => b.mute, setMute: (v) => { b.mute = v } }))
  const mains = cur.mains.map((m): Fader => ({ kind: 'main', id: m.id, name: m.name, color: 0, sub: 'MAIN', silent: false, getFader: () => m.fader, setFader: (v) => { m.fader = v }, getMute: () => m.mute, setMute: (v) => { m.mute = v } }))
  const mtx = cur.matrices.map((m): Fader => ({ kind: 'matrix', id: m.id, name: m.name, color: 0, sub: 'MATRIX', silent: false, getFader: () => m.fader, setFader: (v) => { m.fader = v }, getMute: () => m.mute, setMute: (v) => { m.mute = v } }))
  return { bank: layer === 'channels' ? ch : bus, out: [...mains, ...mtx] }
}

const SCALE = [10, 0, -10, -20, -30, -40, -60]

function makeStrip(f: Fader): HTMLElement {
  const key = keyOf(f.kind, f.id)
  const fader = el<HTMLInputElement>('input', { type: 'range', class: 'fader', min: '0', max: String(POS_MAX), step: '1', value: String(dbToFader(f.getFader())) })
  fader.setAttribute('aria-label', `Fader ${f.name}`)
  const db = el('div', { class: 'db', textContent: dbText(f.getFader()) })
  const mute = el<HTMLButtonElement>('button', { class: 'mute', textContent: 'MUTE' })
  const isCh = f.kind === 'ch'
  const solo = el<HTMLButtonElement>('button', { class: 'solo', textContent: isCh ? 'SOLO' : 'LISTEN', title: isCh ? 'Listen to this channel alone' : 'Listen to this output' })
  const meter = el('i')
  const gr = el('div', { class: 'gr' })
  const chips = isCh ? ['G', 'E', 'D'].map((t) => el('span', { class: 'chip', textContent: t })) : []
  const scale = el('div', { class: 'scale' }, ...SCALE.map((d) => sty(el('span', { textContent: String(d) }), { bottom: `${posOf(d) * 100}%` })))
  const tag = el('div', { class: 'tag', textContent: f.name, title: `${f.kind === 'ch' ? `Channel ${f.id}` : f.kind} ${f.name}` })
  tag.style.background = COLORS[f.color] ?? COLORS[0]
  tag.style.color = LIGHT.has(f.color) ? '#111' : '#fff'
  const root = el('div', { class: `strip ${f.kind}` },
    el('div', { class: 'top' }, el('b', { textContent: isCh ? String(f.id) : f.kind === 'bus' ? `B${f.id}` : f.kind === 'main' ? `M${f.id}` : `MX${f.id}` }), el('span', { textContent: isCh ? f.sub : f.kind === 'main' ? 'MAIN' : f.kind === 'matrix' ? 'MTX' : '' })),
    el('div', { class: 'chips' }, ...chips), gr,
    el('div', { class: 'fd' }, scale, fader, el('div', { class: 'vm' }, meter)), db,
    el('div', { class: 'btns' }, mute, solo), tag)
  root.onclick = () => select(f)
  fader.onclick = (e) => e.stopPropagation()
  fader.oninput = () => { f.setFader(faderToDb(Number(fader.value))); db.textContent = dbText(f.getFader()); changed(); if (f.kind === 'ch' && f.id === selected) refreshDetailValues() }
  mute.onclick = (e) => { e.stopPropagation(); f.setMute(!f.getMute()); changed(); refreshStrip(f) }
  solo.onclick = (e) => {
    e.stopPropagation()
    if (isCh) { if (soloed.has(f.id)) soloed.delete(f.id); else soloed.add(f.id); engine?.setSolo(soloed, cur) } else { listen = { kind: f.kind as Listen['kind'], id: f.id }; engine?.listen(listen); buildTop() }
    refreshAllStrips()
  }
  stripUi.set(key, { root, fader, db, mute, solo, meter, gr, chips })
  return root
}

function refreshStrip(f: Fader): void {
  const u = stripUi.get(keyOf(f.kind, f.id))
  if (!u) return
  const isSel = f.kind === 'ch' ? f.id === selected : selectedOut === keyOf(f.kind, f.id)
  u.mute.classList.toggle('on', f.getMute())
  u.solo.classList.toggle('on', f.kind === 'ch' ? soloed.has(f.id) : listen.kind === f.kind && listen.id === f.id)
  u.root.classList.toggle('sel', isSel)
  u.root.classList.toggle('silent', f.silent || f.getMute())
  u.fader.value = String(dbToFader(f.getFader()))
  u.db.textContent = dbText(f.getFader())
  if (f.channel) {
    const c = f.channel
    ;[c.gate.on, c.eq.on, c.comp.on].forEach((on, i) => u.chips[i]?.classList.toggle('on', on))
  }
}

function refreshAllStrips(): void {
  const { bank, out } = faders()
  for (const f of [...bank, ...out]) refreshStrip(f)
}

let selectedOut = ''

function buildStrips(): void {
  stripUi.clear()
  const { bank, out } = faders()
  $('bank').replaceChildren(...bank.map(makeStrip))
  $('outs').replaceChildren(el('div', { class: 'cap', textContent: 'MAIN' }), el('div', { class: 'row2' }, ...out.map(makeStrip)))
  refreshAllStrips()
}

function select(f: Fader): void {
  if (f.kind === 'ch') { selected = f.id; selectedOut = '' } else selectedOut = keyOf(f.kind, f.id)
  refreshAllStrips()
  buildDetail()
}

/** Light work after any edit: the sound, the little G E D lights, the curves and the counters in the top bar. */
function afterEdit(): void {
  engine?.apply(cur)
  const c = channel()
  if (c) {
    const u = stripUi.get(keyOf('ch', c.id))
    if (u) [c.gate.on, c.eq.on, c.comp.on].forEach((on, i) => u.chips[i]?.classList.toggle('on', on))
  }
  redraw.forEach((r) => r())
  refreshTop()
}

// --- knobs and graphs ----------------------------------------------------------------------------------------------------

const SVG = 'http://www.w3.org/2000/svg'
const polar = (r: number, deg: number): [number, number] => [24 + r * Math.sin((deg * Math.PI) / 180), 24 - r * Math.cos((deg * Math.PI) / 180)]
function arcPath(r: number, from: number, to: number): string {
  const [x0, y0] = polar(r, from)
  const [x1, y1] = polar(r, to)
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`
}

interface KnobOptions { label: string; min: number; max: number; step?: number; get(): number; set(v: number): void; fmt: Fmt; log?: boolean; color?: string; disabled?: () => boolean }
type Fmt = (v: number) => string

/** A rotary control like the console's: drag up or down (hold Shift for fine), use the wheel, arrow keys, or double-click to reset. */
function knob(o: KnobOptions): HTMLElement {
  const initial = o.get()
  const toFrac = (v: number): number => Math.min(1, Math.max(0, o.log ? Math.log(Math.max(o.min, v) / o.min) / Math.log(o.max / o.min) : (v - o.min) / (o.max - o.min)))
  const fromFrac = (f: number): number => {
    const v = o.log ? o.min * (o.max / o.min) ** f : o.min + f * (o.max - o.min)
    return o.step ? Math.round(v / o.step) * o.step : v
  }
  const svg = document.createElementNS(SVG, 'svg')
  svg.setAttribute('viewBox', '0 0 48 48')
  svg.setAttribute('width', '42')
  svg.setAttribute('height', '42')
  const track = document.createElementNS(SVG, 'path')
  track.setAttribute('d', arcPath(19, -135, 135))
  track.setAttribute('class', 'ktrack')
  const val = document.createElementNS(SVG, 'path')
  val.setAttribute('class', 'kval')
  val.style.stroke = o.color ?? 'var(--knob)'
  const needle = document.createElementNS(SVG, 'line')
  needle.setAttribute('class', 'kneedle')
  svg.append(track, val, needle)
  const value = el('div', { class: 'kv', textContent: o.fmt(initial) })
  const root = el('div', { class: 'knob', tabIndex: 0, title: `${o.label} (drag, wheel or arrow keys; double-click to reset)` }, el('div', { class: 'kl', textContent: o.label }), svg, value)
  root.setAttribute('role', 'slider')
  root.setAttribute('aria-label', o.label)
  root.setAttribute('aria-valuemin', String(o.min))
  root.setAttribute('aria-valuemax', String(o.max))
  const draw = (): void => {
    const v = o.get()
    const f = toFrac(v)
    const a = -135 + f * 270
    val.setAttribute('d', f < 0.004 ? '' : arcPath(19, -135, a))
    const [x1, y1] = polar(9, a)
    const [x2, y2] = polar(17, a)
    needle.setAttribute('x1', String(x1)); needle.setAttribute('y1', String(y1)); needle.setAttribute('x2', String(x2)); needle.setAttribute('y2', String(y2))
    value.textContent = o.fmt(v)
    root.setAttribute('aria-valuenow', String(v))
    root.classList.toggle('off', !!o.disabled?.())
  }
  const setFrac = (f: number): void => { o.set(fromFrac(Math.min(1, Math.max(0, f)))); draw(); afterEdit() }
  let drag: { y: number; f: number } | null = null
  root.onpointerdown = (e) => { root.setPointerCapture(e.pointerId); drag = { y: e.clientY, f: toFrac(o.get()) }; e.preventDefault(); root.focus() }
  root.onpointermove = (e) => { if (drag) setFrac(drag.f + (drag.y - e.clientY) / (e.shiftKey ? 700 : 160)) }
  root.onpointerup = () => { drag = null }
  root.onwheel = (e) => { e.preventDefault(); setFrac(toFrac(o.get()) - Math.sign(e.deltaY) * (e.shiftKey ? 0.004 : 0.02)) }
  root.ondblclick = () => { o.set(initial); draw(); afterEdit() }
  root.onkeydown = (e) => {
    const k = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -1 : 0
    if (k) { e.preventDefault(); setFrac(toFrac(o.get()) + k * (e.shiftKey ? 0.005 : 0.02)) }
  }
  draw()
  redraw.push(draw)
  return root
}

function button(label: string, get: () => boolean, set: (v: boolean) => void, cls = ''): HTMLButtonElement {
  const b = el<HTMLButtonElement>('button', { class: `tog ${cls}`, textContent: label })
  const paint = (): void => { b.classList.toggle('on', get()) }
  b.onclick = () => { set(!get()); paint(); afterEdit() }
  paint()
  redraw.push(paint)
  return b
}

const NAMES = { eq: ['#ef4444', '#f59e0b', '#22c55e', '#38bdf8', '#a78bfa', '#f472b6'] }

/** A small graph: `draw` gets the 2D context and the size. */
function graph(width: number, height: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void): HTMLCanvasElement {
  const dpr = window.devicePixelRatio || 1
  const cv = el<HTMLCanvasElement>('canvas', { width: width * dpr, height: height * dpr, class: 'graph' })
  cv.style.width = `${width}px`
  cv.style.height = `${height}px`
  const g = cv.getContext('2d')!
  const paint = (): void => {
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, width, height)
    g.fillStyle = '#080a0d'
    g.fillRect(0, 0, width, height)
    draw(g, width, height)
  }
  paint()
  redraw.push(paint)
  return cv
}

function grid(g: CanvasRenderingContext2D, w: number, h: number, xs: number[], ys: number[]): void {
  g.strokeStyle = '#1f252d'
  g.lineWidth = 1
  g.beginPath()
  for (const x of xs) { g.moveTo(Math.round(x) + 0.5, 0); g.lineTo(Math.round(x) + 0.5, h) }
  for (const y of ys) { g.moveTo(0, Math.round(y) + 0.5); g.lineTo(w, Math.round(y) + 0.5) }
  g.stroke()
}

function eqGraph(c: Channel): HTMLCanvasElement {
  const W = 400, H = 130, RANGE = 15
  const fx = (f: number): number => (Math.log(f / 20) / Math.log(1000)) * W
  const dy = (d: number): number => H / 2 - (Math.max(-RANGE, Math.min(RANGE, d)) / RANGE) * (H / 2 - 4)
  return graph(W, H, (g, w, h) => {
    grid(g, w, h, [100, 1000, 10000].map(fx), [-10, -5, 0, 5, 10].map(dy))
    g.strokeStyle = '#2d3540'
    g.beginPath(); g.moveTo(0, dy(0)); g.lineTo(w, dy(0)); g.stroke()
    const cv = eqCurve(c.eq, c.filters)
    g.beginPath()
    cv.freq.forEach((f, i) => { const x = fx(f), y = dy(cv.db[i]); if (i) g.lineTo(x, y); else g.moveTo(x, y) })
    g.strokeStyle = c.eq.on ? '#ffd34d' : '#6b7280'
    g.lineWidth = 2
    g.stroke()
    g.lineTo(w, dy(0)); g.lineTo(0, dy(0)); g.closePath()
    g.fillStyle = c.eq.on ? 'rgba(255, 211, 77, .12)' : 'rgba(107, 114, 128, .1)'
    g.fill()
    const bands = [c.eq.low, ...c.eq.bands, c.eq.high]
    bands.forEach((b, i) => { g.fillStyle = NAMES.eq[i]; g.beginPath(); g.arc(fx(b.freq), dy(c.eq.on ? b.gain : 0), 4, 0, Math.PI * 2); g.fill() })
    g.fillStyle = '#5c6573'; g.font = '10px system-ui'
    for (const [f, t] of [[100, '100'], [1000, '1k'], [10000, '10k']] as const) g.fillText(t, fx(f) + 3, h - 4)
  })
}

function dynGraph(color: string, curve: (inDb: number) => number, marker: () => number, on: () => boolean): HTMLCanvasElement {
  const S = 130, MIN = -80
  const px = (d: number): number => ((Math.max(MIN, Math.min(0, d)) - MIN) / -MIN) * (S - 8) + 4
  const py = (d: number): number => S - px(d)
  return graph(S, S, (g, w, h) => {
    grid(g, w, h, [-60, -40, -20].map(px), [-60, -40, -20].map(py))
    g.strokeStyle = '#2d3540'; g.beginPath(); g.moveTo(px(MIN), py(MIN)); g.lineTo(px(0), py(0)); g.stroke()
    g.strokeStyle = '#3b4553'; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(px(marker()), 0); g.lineTo(px(marker()), h); g.stroke(); g.setLineDash([])
    g.beginPath()
    for (let d = MIN; d <= 0; d += 1) { const x = px(d), y = py(curve(d)); if (d === MIN) g.moveTo(x, y); else g.lineTo(x, y) }
    g.strokeStyle = on() ? color : '#6b7280'
    g.lineWidth = 2
    g.stroke()
  })
}

// --- detail --------------------------------------------------------------------------------------------------------------

const db1: Fmt = (v) => `${v.toFixed(1)} dB`
const db0: Fmt = (v) => `${Math.round(v)} dB`
const ms1: Fmt = (v) => `${Number(v.toFixed(v < 10 ? 1 : 0))} ms`
const hz1: Fmt = (v) => (v >= 1000 ? `${Number((v / 1000).toFixed(2))} k` : `${Math.round(v)} Hz`)
const num1: Fmt = (v) => String(Number(v.toFixed(2)))

function section(title: string, ...kids: (Node | string)[]): HTMLElement {
  return el('div', { class: 'sec' }, el('div', { class: 'st', textContent: title }), ...kids)
}
const knobRow = (...k: HTMLElement[]): HTMLElement => el('div', { class: 'krow' }, ...k)

function channelDetail(c: Channel): HTMLElement[] {
  const eqBand = (title: string, b: { gain: number; freq: number; q: number }, i: number): HTMLElement =>
    el('div', { class: 'band' }, sty(el('div', { class: 'bt', textContent: title }), { borderColor: NAMES.eq[i] }),
      knob({ label: 'Gain', min: -15, max: 15, step: 0.1, get: () => b.gain, set: (v) => { b.gain = v }, fmt: db1, color: NAMES.eq[i], disabled: () => !c.eq.on }),
      knob({ label: 'Freq', min: 20, max: 20000, log: true, get: () => b.freq, set: (v) => { b.freq = v }, fmt: hz1, color: NAMES.eq[i], disabled: () => !c.eq.on }),
      knob({ label: 'Q', min: 0.3, max: 10, log: true, get: () => b.q, set: (v) => { b.q = v }, fmt: num1, color: NAMES.eq[i], disabled: () => !c.eq.on }))
  return [
    section('INPUT',
      knobRow(knob({ label: 'Trim', min: -18, max: 18, step: 0.5, get: () => c.trim, set: (v) => { c.trim = v }, fmt: db1 }), knob({ label: 'Pan', min: -100, max: 100, step: 1, get: () => c.pan, set: (v) => { c.pan = v }, fmt: (v) => (v === 0 ? 'C' : v < 0 ? `L${-v}` : `R${v}`) })),
      el('div', { class: 'tr' }, button('LOW CUT', () => c.filters.lowCut.on, (v) => { c.filters.lowCut.on = v }), button('HIGH CUT', () => c.filters.highCut.on, (v) => { c.filters.highCut.on = v })),
      knobRow(knob({ label: 'Low cut', min: 20, max: 600, log: true, get: () => c.filters.lowCut.freq, set: (v) => { c.filters.lowCut.freq = v }, fmt: hz1, disabled: () => !c.filters.lowCut.on }), knob({ label: 'High cut', min: 1000, max: 20000, log: true, get: () => c.filters.highCut.freq, set: (v) => { c.filters.highCut.freq = v }, fmt: hz1, disabled: () => !c.filters.highCut.on }))),
    section('GATE',
      el('div', { class: 'tr' }, button('ON', () => c.gate.on, (v) => { c.gate.on = v })),
      dynGraph('#3ddc84', (d) => gateCurve(c.gate, d), () => c.gate.threshold, () => c.gate.on),
      knobRow(
        knob({ label: 'Thresh', min: -80, max: 0, step: 0.5, get: () => c.gate.threshold, set: (v) => { c.gate.threshold = v }, fmt: db1, color: '#3ddc84', disabled: () => !c.gate.on }),
        knob({ label: 'Range', min: 3, max: 60, step: 0.5, get: () => c.gate.range, set: (v) => { c.gate.range = v }, fmt: db1, color: '#3ddc84', disabled: () => !c.gate.on }),
        knob({ label: 'Attack', min: 0, max: 200, step: 1, get: () => c.gate.attack, set: (v) => { c.gate.attack = v }, fmt: ms1, color: '#3ddc84', disabled: () => !c.gate.on }),
        knob({ label: 'Hold', min: 0, max: 500, step: 1, get: () => c.gate.hold, set: (v) => { c.gate.hold = v }, fmt: ms1, color: '#3ddc84', disabled: () => !c.gate.on }),
        knob({ label: 'Release', min: 5, max: 2000, log: true, step: 1, get: () => c.gate.release, set: (v) => { c.gate.release = v }, fmt: ms1, color: '#3ddc84', disabled: () => !c.gate.on }))),
    section('EQ', el('div', { class: 'tr' }, button('ON', () => c.eq.on, (v) => { c.eq.on = v })), eqGraph(c),
      el('div', { class: 'bands' }, eqBand(c.eq.low.shelf ? 'LOW SHELF' : 'LOW', c.eq.low, 0), ...c.eq.bands.map((b, i) => eqBand(`BAND ${i + 1}`, b, i + 1)), eqBand(c.eq.high.shelf ? 'HIGH SHELF' : 'HIGH', c.eq.high, 5))),
    section(`DYNAMICS · ${c.comp.model}`,
      el('div', { class: 'tr' }, button('ON', () => c.comp.on, (v) => { c.comp.on = v })),
      c.comp.model === 'COMP' ? dynGraph('#ff8a3d', (d) => compCurve(c.comp, d), () => c.comp.threshold, () => c.comp.on) : el('div', { class: 'dim note', textContent: `The ${c.comp.model} model is not simulated: it lets the signal through.` }),
      knobRow(
        knob({ label: 'Thresh', min: -60, max: 0, step: 0.5, get: () => c.comp.threshold, set: (v) => { c.comp.threshold = v }, fmt: db1, color: '#ff8a3d', disabled: () => !c.comp.on }),
        knob({ label: 'Ratio', min: 1, max: 20, log: true, get: () => c.comp.ratio, set: (v) => { c.comp.ratio = v }, fmt: (v) => `${num1(v)}:1`, color: '#ff8a3d', disabled: () => !c.comp.on }),
        knob({ label: 'Knee', min: 0, max: 20, step: 1, get: () => c.comp.knee, set: (v) => { c.comp.knee = v }, fmt: db0, color: '#ff8a3d', disabled: () => !c.comp.on }),
        knob({ label: 'Attack', min: 0.5, max: 200, log: true, get: () => c.comp.attack, set: (v) => { c.comp.attack = v }, fmt: ms1, color: '#ff8a3d', disabled: () => !c.comp.on }),
        knob({ label: 'Release', min: 10, max: 2000, log: true, get: () => c.comp.release, set: (v) => { c.comp.release = v }, fmt: ms1, color: '#ff8a3d', disabled: () => !c.comp.on }),
        knob({ label: 'Gain', min: 0, max: 24, step: 0.5, get: () => c.comp.makeup, set: (v) => { c.comp.makeup = v }, fmt: db1, color: '#ff8a3d', disabled: () => !c.comp.on }))),
    sendsSection(c),
  ]
}

function sendsSection(c: Channel): HTMLElement {
  const mains = c.mains.map((m) => {
    const main = cur.mains.find((x) => x.id === m.main)
    return main ? el('div', { class: 'send' }, el('div', { class: 'kl', textContent: main.name }), button('ON', () => m.on, (v) => { m.on = v }, 'main')) : null
  }).filter((x): x is HTMLElement => x !== null)
  const sends = c.sends.map((s) => {
    const bus = cur.buses.find((b) => b.id === s.bus)
    if (!bus) return null
    return el('div', { class: 'send' },
      knob({ label: bus.name, min: -60, max: 10, step: 0.5, get: () => (s.level <= OFF_DB ? -60 : s.level), set: (v) => { s.level = v <= -59.9 ? -144 : v }, fmt: (v) => (v <= -59.9 ? '-∞' : db1(v)), disabled: () => !s.on }),
      el('div', { class: 'tr' }, button('ON', () => s.on, (v) => { s.on = v }), (() => { const b = button(s.pre ? 'PRE' : 'POST', () => s.pre, (v) => { s.pre = v; b.textContent = v ? 'PRE' : 'POST'; void rebuildEngine() }, 'pre'); return b })()))
  }).filter((x): x is HTMLElement => x !== null)
  return el('div', { class: 'sec wide' }, el('div', { class: 'st', textContent: 'SENDS' }), el('div', { class: 'sends' }, ...mains, ...sends))
}

function busDetail(f: { kind: string; id: number }): HTMLElement[] {
  if (f.kind === 'bus') {
    const b = cur.buses.find((x) => x.id === f.id)!
    return [section(`BUS ${b.id} ${b.name}`,
      el('div', { class: 'sends' }, ...b.mains.map((m) => { const main = cur.mains.find((x) => x.id === m.main); return main ? el('div', { class: 'send' }, el('div', { class: 'kl', textContent: `To ${main.name}` }), button('ON', () => m.on, (v) => { m.on = v }, 'main')) : el('span') }),
        ...b.matrix.map((x) => { const mtx = cur.matrices.find((y) => y.id === x.mtx); return mtx ? el('div', { class: 'send' }, knob({ label: `To ${mtx.name}`, min: -60, max: 10, step: 0.5, get: () => (x.level <= OFF_DB ? -60 : x.level), set: (v) => { x.level = v <= -59.9 ? -144 : v }, fmt: (v) => (v <= -59.9 ? '-∞' : db1(v)), disabled: () => !x.on }), button('ON', () => x.on, (v) => { x.on = v })) : el('span') })),
      el('div', { class: 'dim note', textContent: 'The fader and mute are on the strip. The bus has no EQ or dynamics in the trainer yet.' }))]
  }
  return [section(f.kind === 'main' ? 'MAIN' : 'MATRIX', el('div', { class: 'dim note', textContent: 'The fader and mute are on the strip. Press LISTEN to hear this output.' }))]
}

function refreshDetailValues(): void { redraw.forEach((r) => r()) }

function buildDetail(): void {
  redraw = []
  const c = selectedOut ? undefined : channel()
  if (!c) {
    if (!selectedOut) { $('detail').replaceChildren(el('div', { class: 'dim', textContent: 'No channel selected.' })); return }
    const [kind, id] = selectedOut.split(':')
    $('detail').replaceChildren(...busDetail({ kind, id: Number(id) }))
    return
  }
  const tag = el('span', { class: 'ctag', textContent: c.name || `Ch ${c.id}` })
  tag.style.background = COLORS[c.color] ?? COLORS[0]
  tag.style.color = LIGHT.has(c.color) ? '#111' : '#fff'
  const notes = checkSnapshot({ ...cur, channels: [c] })
  $('detail').replaceChildren(
    el('div', { class: 'dhead' }, el('span', { class: 'cn', textContent: `CH ${c.id}` }), tag, el('span', { class: 'dim', textContent: c.hasSource ? `input ${c.source.grp}${c.source.in}` : 'no input patched' }),
      ...(notes.length ? [el('span', { class: 'nb', title: notes.map((n) => n.text).join('\n'), textContent: `⚠ ${notes.length}` })] : []),
      el('span', { class: 'grow' }), el<HTMLButtonElement>('button', { class: 'flat', textContent: 'PLAY A FILE ON THIS CHANNEL…', onclick: () => void openFileOnChannel() })),
    el('div', { class: 'sections' }, ...channelDetail(c)))
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
  playBtn = el<HTMLButtonElement>('button', { class: 'play', onclick: () => void togglePlay() })
  checksBtn = el<HTMLButtonElement>('button', { class: 'flat', onclick: () => showChecks() })
  changesBtn = el<HTMLButtonElement>('button', { class: 'flat', onclick: () => showChanges() })
  const select = el<HTMLSelectElement>('select', {}, ...listenOptions().map((o) => el<HTMLOptionElement>('option', { value: o.value, textContent: o.label, selected: o.value === `${listen.kind}:${listen.id}` })))
  select.setAttribute('aria-label', 'Listen to')
  select.onchange = () => { const [kind, id] = select.value.split(':'); listen = { kind: kind as Listen['kind'], id: Number(id) }; engine?.listen(listen); refreshAllStrips() }
  outMeter = el('i')
  const viewBtn = (id: typeof view, label: string) => el<HTMLButtonElement>('button', { class: `tab ${view === id ? 'on' : ''}`, textContent: label, onclick: () => setView(id) })
  const layerBtn = (id: typeof layer, label: string) => el<HTMLButtonElement>('button', { class: `tab ${layer === id ? 'on' : ''}`, textContent: label, onclick: () => { layer = id; buildStrips(); buildTop() } })
  $('top').replaceChildren(
    el('div', { class: 'brand' }, el('b', { textContent: 'WING' }), el('span', { textContent: 'TRAINER' })),
    el('div', { class: 'tabs views' }, viewBtn('console', 'CONSOLE'), viewBtn('routing', 'ROUTING')),
    ...(view === 'console' ? [el('div', { class: 'tabs' }, layerBtn('channels', 'CHANNELS'), layerBtn('buses', 'BUSES'))] : []),
    el('span', { class: 'sep' }), playBtn,
    el('label', { class: 'lst', textContent: 'LISTEN ' }, select), el('div', { class: 'outmeter' }, outMeter),
    el('span', { class: 'grow' }),
    el<HTMLButtonElement>('button', { class: 'flat', textContent: 'SNAPSHOT…', onclick: () => void openSnapshot() }),
    el<HTMLButtonElement>('button', { class: 'flat', textContent: 'RECORDING…', onclick: () => void openRecording() }),
    el<HTMLButtonElement>('button', { class: 'flat', textContent: 'TEST SIGNALS', title: 'Play a test signal on every channel again', onclick: () => void useTestSignals() }),
    el('span', { class: 'sep' }), checksBtn, changesBtn,
    el<HTMLButtonElement>('button', { class: 'flat', textContent: 'RESET', title: 'Back to the snapshot as it was loaded', onclick: () => void reset() }))
  refreshTop()
}

function refreshTop(): void {
  const findings = checkSnapshot(cur).length
  const changes = diffSnapshots(base, cur).length + (order.join() !== baseOrder.join() ? 1 : 0)
  checksBtn.replaceChildren('CHECKS', ...(findings ? [el('span', { class: 'badge', textContent: String(findings) })] : []))
  changesBtn.replaceChildren('CHANGES', ...(changes ? [el('span', { class: 'badge', textContent: String(changes) })] : []))
  $('src').textContent = `${sourceName}${recording ? ' · recording' : ' · test signals'}`
  playBtn.textContent = engine?.playing ? '■ STOP' : '▶ PLAY'
  playBtn.classList.toggle('on', !!engine?.playing)
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
  order = [...baseOrder]
  soloed.clear()
  buildStrips()
  buildDetail()
  routing.render()
  await rebuildEngine()
  refreshTop()
  status('Back to the snapshot as it was loaded.')
}

// --- dialogs -------------------------------------------------------------------------------------------------------------

const findingRow = (f: Finding): HTMLElement => el('div', { class: `finding ${f.severity}`, textContent: f.text })

function dialog(title: string, body: HTMLElement, extra: HTMLElement[] = []): void {
  const dlg = $<HTMLDialogElement>('dlg')
  dlg.replaceChildren(el('h3', { textContent: title }), el('div', { class: 'body' }, body), el('div', { class: 'btns' }, ...extra, el<HTMLButtonElement>('button', { class: 'flat', textContent: 'CLOSE', onclick: () => dlg.close() })))
  dlg.showModal()
}

function showChecks(): void {
  const findings = checkSnapshot(cur)
  dialog('Checks', el('div', {}, ...(findings.length ? findings.map(findingRow) : [el('div', { class: 'dim', textContent: 'No problems found in the settings.' })])))
}

function showChanges(): void {
  const lines = diffSnapshots(base, cur).map(describeChange)
  if (order.join() !== baseOrder.join()) lines.push(`Fader order: ${order.map((id) => channel(id)?.name || id).join(', ')}`)
  const copy = el<HTMLButtonElement>('button', { class: 'flat', textContent: 'COPY', onclick: () => void navigator.clipboard.writeText(lines.join('\n')) })
  dialog('What you changed', el('div', {}, el('p', { class: 'dim', textContent: 'The trainer does not write snapshots. Make these changes on the console to use them.' }), ...(lines.length ? lines.map((l) => el('div', { class: 'finding', textContent: l })) : [el('div', { class: 'dim', textContent: 'Nothing changed yet.' })])), lines.length ? [copy] : [])
}

// --- meters --------------------------------------------------------------------------------------------------------------

/** 0 to 100: where a level in dB sits on the meter, on the same scale as the fader. */
const meterPct = (db: number): number => posOf(db) * 100

function tick(): void {
  if (engine) {
    const lv = engine.levels()
    const set = (key: string, peak: number): void => { const u = stripUi.get(key); if (u) u.meter.style.height = `${100 - meterPct(peak)}%` }
    for (const [id, l] of lv.channels) {
      set(keyOf('ch', id), l.peak)
      const u = stripUi.get(keyOf('ch', id))
      if (u) u.gr.textContent = !engine.playing ? '' : [l.gate < -1 ? `G ${l.gate.toFixed(0)}` : '', l.comp < -1 ? `C ${l.comp.toFixed(0)}` : ''].filter(Boolean).join(' ')
    }
    for (const [id, p] of lv.buses) set(keyOf('bus', id), p)
    for (const [id, p] of lv.mains) set(keyOf('main', id), p)
    for (const [id, p] of lv.matrices) set(keyOf('matrix', id), p)
    const out = listen.kind === 'main' ? lv.mains : listen.kind === 'bus' ? lv.buses : lv.matrices
    outMeter.style.width = `${meterPct(out.get(listen.id) ?? -100)}%`
  }
  requestAnimationFrame(tick)
}

// --- start ---------------------------------------------------------------------------------------------------------------

// The mouse wheel scrolls the strips sideways (a plain wheel only knows up and down).
$('bank').addEventListener('wheel', (e) => {
  const bank = $('bank')
  if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && bank.scrollWidth > bank.clientWidth) { bank.scrollLeft += e.deltaY; e.preventDefault() }
}, { passive: false })

void (async () => {
  await useSnapshot(parseSnapshot(sampleJson), 'sample setup')
  requestAnimationFrame(tick)
})()

// For the end-to-end test.
window.app = { get engine() { return engine }, get current() { return cur }, get base() { return base }, rebuildEngine, ensureEngine, Engine, testSignal }
