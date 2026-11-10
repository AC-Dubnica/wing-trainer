import { compParams, cutFilters, dbToGain, eqBands, gateParams, panValue, type BiquadSpec } from '../shared/convert'
import type { Snapshot } from '../shared/model'

/** What the speakers (headphones) play: the sum of one output of the console, or the soloed channels. */
export type Listen = { kind: 'main' | 'bus' | 'matrix'; id: number }

/** What a channel plays: one buffer for a mono channel (or a ready stereo buffer), or a left and a right buffer for a stereo channel. */
interface Buffers { mono: AudioBuffer | null; left: AudioBuffer | null; right: AudioBuffer | null }

interface Strip {
  buffers: Buffers
  sources: AudioBufferSourceNode[]
  /** Stereo channels: where the sources go in (a pair of ports is a stereo signal), and the merger that joins a left and a right buffer. */
  stereoIn: GainNode | null
  merger: ChannelMergerNode | null
  trim: GainNode
  lowCut: BiquadFilterNode
  highCut: BiquadFilterNode
  eq: BiquadFilterNode[]
  gate: AudioWorkletNode
  comp: AudioWorkletNode
  preTap: GainNode
  fader: GainNode
  pan: StereoPannerNode
  postTap: GainNode
  meter: AnalyserNode
  /** Sends to buses, taken before or after the fader as the snapshot says. */
  sends: Map<number, { gain: GainNode; pre: boolean }>
  mains: Map<number, GainNode>
  soloSend: GainNode
  /** Gain reduction reported by the worklets, in dB (<= 0). */
  gateDb: number
  compDb: number
}

interface Out {
  input: GainNode
  fader: GainNode
  meter: AnalyserNode
}

const TIME = 0.015

/**
 * The sound of the console: a Web Audio graph made from a snapshot. Each channel goes through trim, low and high cut, six EQ bands,
 * the gate and the compressor (the same worklets PreStreamer's mixer uses), then the fader and pan; from there it feeds the mains
 * and the bus sends. Buses feed the mains and the matrix; whatever the operator listens to goes to the speakers.
 * It works on any audio context, so a test can render it offline.
 */
export class Engine {
  private strips = new Map<number, Strip>()
  private buses = new Map<number, Out & { mains: Map<number, GainNode>; matrix: Map<number, GainNode> }>()
  private mains = new Map<number, Out>()
  private matrices = new Map<number, Out>()
  private mainMatrix = new Map<number, Map<number, GainNode>>()
  private soloBus: GainNode
  private monitor: GainNode
  private listening: Listen = { kind: 'main', id: 1 }
  private soloed = new Set<number>()
  private connected: AudioNode | null = null
  private scratch = new Float32Array(2048)

  private constructor(readonly ctx: BaseAudioContext) {
    this.soloBus = ctx.createGain()
    this.monitor = ctx.createGain()
    this.monitor.connect(ctx.destination)
  }

  static async create(ctx: BaseAudioContext): Promise<Engine> {
    await ctx.audioWorklet.addModule('gate-worklet.js')
    await ctx.audioWorklet.addModule('comp-worklet.js')
    return new Engine(ctx)
  }

  /** Builds the graph for a snapshot (replacing any earlier one) and sets every value. */
  build(snapshot: Snapshot): void {
    this.dispose()
    const ctx = this.ctx
    const out = (): Out => {
      const input = ctx.createGain()
      const fader = ctx.createGain()
      const meter = ctx.createAnalyser()
      input.connect(fader)
      fader.connect(meter)
      return { input, fader, meter }
    }
    for (const m of snapshot.mains) this.mains.set(m.id, out())
    for (const m of snapshot.matrices) this.matrices.set(m.id, out())
    for (const m of snapshot.mains) {
      const sends = new Map<number, GainNode>()
      for (const x of m.matrix) { const mtx = this.matrices.get(x.mtx); if (!mtx) continue; const g = ctx.createGain(); this.mains.get(m.id)!.meter.connect(g); g.connect(mtx.input); sends.set(x.mtx, g) }
      this.mainMatrix.set(m.id, sends)
    }
    for (const b of snapshot.buses) {
      const o = out()
      const mains = new Map<number, GainNode>()
      const matrix = new Map<number, GainNode>()
      for (const m of b.mains) { const g = ctx.createGain(); o.meter.connect(g); const main = this.mains.get(m.main); if (main) g.connect(main.input); mains.set(m.main, g) }
      for (const x of b.matrix) { const g = ctx.createGain(); o.meter.connect(g); const mtx = this.matrices.get(x.mtx); if (mtx) g.connect(mtx.input); matrix.set(x.mtx, g) }
      this.buses.set(b.id, { ...o, mains, matrix })
    }
    for (const c of snapshot.channels) {
      const trim = ctx.createGain()
      const lowCut = ctx.createBiquadFilter()
      const highCut = ctx.createBiquadFilter()
      const eq = Array.from({ length: 6 }, () => ctx.createBiquadFilter())
      // A channel on a stereo pair of ports keeps two channels all the way through (the gate and compressor detect on the louder side).
      const width = c.stereo === null ? 1 : 2
      const gate = new AudioWorkletNode(ctx, 'gate', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [width] })
      const comp = new AudioWorkletNode(ctx, 'compressor', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [width] })
      let stereoIn: GainNode | null = null
      let merger: ChannelMergerNode | null = null
      if (c.stereo !== null) {
        stereoIn = ctx.createGain()
        stereoIn.channelCount = 2
        stereoIn.channelCountMode = 'explicit'
        stereoIn.channelInterpretation = 'speakers' // a mono source on a stereo channel is heard on both sides
        merger = ctx.createChannelMerger(2)
        merger.connect(stereoIn)
        if (c.stereo === 'MS') {
          // Mid and side microphones: left = mid + side, right = mid - side.
          const split = ctx.createChannelSplitter(2)
          const toL = ctx.createGain(), toR = ctx.createGain(), sideR = ctx.createGain()
          sideR.gain.value = -1
          const out = ctx.createChannelMerger(2)
          stereoIn.connect(split)
          split.connect(toL, 0); split.connect(toR, 0) // mid
          split.connect(toL, 1); split.connect(sideR, 1) // side
          sideR.connect(toR)
          toL.connect(out, 0, 0); toR.connect(out, 0, 1)
          out.connect(trim)
        } else stereoIn.connect(trim)
      }
      const preTap = ctx.createGain()
      const fader = ctx.createGain()
      const pan = ctx.createStereoPanner()
      const postTap = ctx.createGain()
      const meter = ctx.createAnalyser()
      const soloSend = ctx.createGain()
      soloSend.gain.value = 0
      const chain: AudioNode[] = [trim, lowCut, highCut, ...eq, gate, comp, preTap, fader, pan, postTap]
      chain.reduce((a, b) => { a.connect(b); return b })
      postTap.connect(meter)
      postTap.connect(soloSend)
      soloSend.connect(this.soloBus)
      const strip: Strip = { buffers: { mono: null, left: null, right: null }, sources: [], stereoIn, merger, trim, lowCut, highCut, eq, gate, comp, preTap, fader, pan, postTap, meter, sends: new Map(), mains: new Map(), soloSend, gateDb: 0, compDb: 0 }
      gate.port.onmessage = (e) => { strip.gateDb = Number(e.data) }
      comp.port.onmessage = (e) => { strip.compDb = Number(e.data) }
      for (const s of c.sends) {
        const bus = this.buses.get(s.bus)
        if (!bus) continue
        const gain = ctx.createGain()
        ;(s.pre ? preTap : postTap).connect(gain)
        gain.connect(bus.input)
        strip.sends.set(s.bus, { gain, pre: s.pre })
      }
      for (const m of c.mains) {
        const main = this.mains.get(m.main)
        if (!main) continue
        const gain = ctx.createGain()
        postTap.connect(gain)
        gain.connect(main.input)
        strip.mains.set(m.main, gain)
      }
      this.strips.set(c.id, strip)
    }
    this.apply(snapshot)
    this.route()
  }

  /** Sets every value of the graph from the snapshot (cheap: call it after any change). */
  apply(s: Snapshot): void {
    const t = this.ctx.currentTime
    const set = (p: AudioParam, v: number) => p.setTargetAtTime(v, t, TIME)
    const spec = (f: BiquadFilterNode, b: BiquadSpec) => { f.type = b.type; set(f.frequency, b.freq); set(f.gain, b.gain); set(f.Q, b.q) }
    for (const c of s.channels) {
      const st = this.strips.get(c.id)
      if (!st) continue
      set(st.trim.gain, dbToGain(c.trim))
      const cut = cutFilters(c.filters)
      spec(st.lowCut, cut.low)
      spec(st.highCut, cut.high)
      eqBands(c.eq).forEach((b, i) => spec(st.eq[i], b))
      for (const [name, v] of Object.entries(gateParams(c.gate))) (st.gate.parameters.get(name) as AudioParam).setValueAtTime(v, t)
      for (const [name, v] of Object.entries(compParams(c.comp))) (st.comp.parameters.get(name) as AudioParam).setValueAtTime(v, t)
      set(st.fader.gain, c.mute ? 0 : dbToGain(c.fader))
      set(st.pan.pan, panValue(c.pan))
      for (const x of c.sends) { const g = st.sends.get(x.bus); if (g) set(g.gain.gain, x.on ? dbToGain(x.level) : 0) }
      for (const m of c.mains) { const g = st.mains.get(m.main); if (g) set(g.gain, m.on ? dbToGain(m.level) : 0) }
      set(st.soloSend.gain, this.soloed.has(c.id) ? 1 : 0)
    }
    for (const b of s.buses) {
      const o = this.buses.get(b.id)
      if (!o) continue
      set(o.fader.gain, b.mute ? 0 : dbToGain(b.fader))
      for (const m of b.mains) { const g = o.mains.get(m.main); if (g) set(g.gain, m.on ? dbToGain(m.level) : 0) }
      for (const x of b.matrix) { const g = o.matrix.get(x.mtx); if (g) set(g.gain, x.on ? dbToGain(x.level) : 0) }
    }
    for (const m of s.mains) {
      const o = this.mains.get(m.id)
      if (o) set(o.fader.gain, m.mute ? 0 : dbToGain(m.fader))
      for (const x of m.matrix) { const g = this.mainMatrix.get(m.id)?.get(x.mtx); if (g) set(g.gain, x.on ? dbToGain(x.level) : 0) }
    }
    for (const m of s.matrices) { const o = this.matrices.get(m.id); if (o) set(o.fader.gain, m.mute ? 0 : dbToGain(m.fader)) }
  }

  /** What a channel plays: one buffer (a mono track, or a stereo file). */
  setBuffer(channel: number, buffer: AudioBuffer | null): void {
    const st = this.strips.get(channel)
    if (st) st.buffers = { mono: buffer, left: null, right: null }
  }

  /** What a stereo channel plays: a track for each side (a side that is missing is silent; with only one the channel plays it on both). */
  setSides(channel: number, left: AudioBuffer | null, right: AudioBuffer | null): void {
    const st = this.strips.get(channel)
    if (st) st.buffers = { mono: null, left, right }
  }

  /** Starts every channel that has something to play, all at the same moment. */
  start(): void {
    this.stop()
    const when = this.ctx.currentTime + 0.05
    const play = (st: Strip, buffer: AudioBuffer, to: AudioNode, input = 0): void => {
      const source = this.ctx.createBufferSource()
      source.buffer = buffer
      source.loop = true
      source.connect(to, 0, input)
      source.start(when)
      st.sources.push(source)
    }
    for (const st of this.strips.values()) {
      const b = st.buffers
      if (st.stereoIn && st.merger && b.left && b.right) {
        play(st, b.left, st.merger, 0) // the two tracks of a pair are the two sides of one signal
        play(st, b.right, st.merger, 1)
        continue
      }
      const one = b.mono ?? b.left ?? b.right
      if (one) play(st, one, st.stereoIn ?? st.trim)
    }
  }

  stop(): void {
    for (const st of this.strips.values()) {
      for (const source of st.sources) {
        try { source.stop() } catch { /* never started */ }
        source.disconnect()
      }
      st.sources = []
    }
  }

  get playing(): boolean {
    return [...this.strips.values()].some((s) => s.sources.length > 0)
  }

  /** What to listen to. Soloed channels take over while any is soloed. */
  listen(l: Listen): void {
    this.listening = l
    this.route()
  }

  setSolo(channels: Set<number>, s: Snapshot): void {
    this.soloed = new Set(channels)
    this.apply(s)
    this.route()
  }

  private route(): void {
    const node: AudioNode | undefined = this.soloed.size ? this.soloBus : this.outOf(this.listening)?.meter
    this.connected?.disconnect(this.monitor)
    this.connected = null
    if (node) { node.connect(this.monitor); this.connected = node }
  }

  private outOf(l: Listen): Out | undefined {
    return l.kind === 'main' ? this.mains.get(l.id) : l.kind === 'bus' ? this.buses.get(l.id) : this.matrices.get(l.id)
  }

  private peakDb(a: AnalyserNode): number {
    if (this.scratch.length < a.fftSize) this.scratch = new Float32Array(a.fftSize)
    a.getFloatTimeDomainData(this.scratch)
    let peak = 0
    for (let i = 0; i < a.fftSize; i++) peak = Math.max(peak, Math.abs(this.scratch[i]))
    return peak < 1e-5 ? -100 : 20 * Math.log10(peak)
  }

  /** Peak levels in dB for the meters. */
  levels(): { channels: Map<number, { peak: number; gate: number; comp: number }>; mains: Map<number, number>; buses: Map<number, number>; matrices: Map<number, number> } {
    const channels = new Map<number, { peak: number; gate: number; comp: number }>()
    for (const [id, s] of this.strips) channels.set(id, { peak: this.peakDb(s.meter), gate: s.gateDb, comp: s.compDb })
    const of = (m: Map<number, Out>): Map<number, number> => new Map([...m].map(([id, o]) => [id, this.peakDb(o.meter)]))
    return { channels, mains: of(this.mains), buses: of(this.buses), matrices: of(this.matrices) }
  }

  private dispose(): void {
    this.stop()
    this.connected?.disconnect(this.monitor)
    this.connected = null
    for (const s of this.strips.values()) { s.stereoIn?.disconnect(); s.merger?.disconnect(); s.trim.disconnect(); s.gate.disconnect(); s.comp.disconnect() }
    this.strips.clear()
    this.buses.clear()
    this.mains.clear()
    this.mainMatrix.clear()
    this.matrices.clear()
  }
}

/**
 * A stand-in signal for a channel that has no recording: noise in bursts, like speech or strumming, so the gate, the compressor
 * and the meters have something to work on. `seed` makes the rhythm differ from channel to channel.
 */
export function testSignal(ctx: BaseAudioContext, seed: number, seconds = 8, stereo = false): AudioBuffer {
  const rate = ctx.sampleRate
  const buffer = ctx.createBuffer(stereo ? 2 : 1, Math.floor(rate * seconds), rate)
  for (let side = 0; side < buffer.numberOfChannels; side++) fillTestSignal(buffer.getChannelData(side), rate, seed + side * 97)
  return buffer
}

function fillTestSignal(data: Float32Array, rate: number, seed: number): void {
  let state = (seed * 2654435761) >>> 0 || 1
  const rand = (): number => { state ^= state << 13; state >>>= 0; state ^= state >>> 17; state ^= state << 5; state >>>= 0; return state / 4294967296 }
  let b0 = 0, b1 = 0, b2 = 0 // pink-ish noise (three one-pole filters)
  const period = 0.5 + (seed % 5) * 0.1
  for (let i = 0; i < data.length; i++) {
    const white = rand() * 2 - 1
    b0 = 0.99765 * b0 + white * 0.099046
    b1 = 0.963 * b1 + white * 0.2965164
    b2 = 0.57 * b2 + white * 1.0526913
    const pink = (b0 + b1 + b2 + white * 0.1848) * 0.11
    const phase = ((i / rate) / period) % 1
    const burst = phase < 0.65 ? Math.sin((phase / 0.65) * Math.PI) : 0 // a burst, then silence: something for the gate to close on
    data[i] = pink * (0.02 + 0.5 * burst * burst)
  }
}
