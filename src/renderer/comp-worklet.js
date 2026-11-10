// Feed-forward compressor / limiter with no hidden make-up gain (unlike the built-in DynamicsCompressorNode,
// whose automatic make-up cancels the reduction). Detects on the loudest channel so a stereo signal keeps its image.
// Runs in AudioWorkletGlobalScope. Parameters are k-rate so the console can change them live.
class Compressor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'enabled', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'threshold', defaultValue: -24, minValue: -80, maxValue: 0, automationRate: 'k-rate' },
      { name: 'ratio', defaultValue: 3, minValue: 1, maxValue: 100, automationRate: 'k-rate' },
      { name: 'knee', defaultValue: 6, minValue: 0, maxValue: 40, automationRate: 'k-rate' },
      { name: 'attack', defaultValue: 10, minValue: 0.01, maxValue: 500, automationRate: 'k-rate' },
      { name: 'release', defaultValue: 150, minValue: 1, maxValue: 5000, automationRate: 'k-rate' },
      { name: 'makeup', defaultValue: 0, minValue: 0, maxValue: 36, automationRate: 'k-rate' },
    ]
  }

  constructor() {
    super()
    this.env = 0 // peak envelope (linear)
    this.grDb = 0 // smoothed gain reduction in dB (<= 0)
    this.sinceReport = 0
  }

  process(inputs, outputs, p) {
    const input = inputs[0]
    const output = outputs[0]
    if (!output || output.length === 0) return true
    if (!input || input.length === 0) {
      for (const ch of output) ch.fill(0)
      return true
    }
    const channels = Math.min(input.length, output.length)
    const frames = input[0].length

    if (p.enabled[0] < 0.5) {
      for (let c = 0; c < channels; c++) output[c].set(input[c])
      this.grDb = 0
    } else {
      const threshold = p.threshold[0]
      const ratio = p.ratio[0]
      const knee = p.knee[0]
      const makeup = 10 ** (p.makeup[0] / 20)
      const attackCoeff = 1 - Math.exp(-1 / ((p.attack[0] / 1000) * sampleRate))
      const releaseCoeff = 1 - Math.exp(-1 / ((p.release[0] / 1000) * sampleRate))
      const envDecay = Math.exp(-1 / (0.01 * sampleRate)) // 10 ms peak hold-off for the level detector
      for (let i = 0; i < frames; i++) {
        let level = 0
        for (let c = 0; c < channels; c++) {
          const v = Math.abs(input[c][i])
          if (v > level) level = v
        }
        this.env = level > this.env ? level : this.env * envDecay
        const levelDb = 20 * Math.log10(this.env + 1e-9)
        const over = levelDb - threshold
        let outDb
        if (2 * over < -knee) outDb = levelDb // below the knee: untouched
        else if (2 * Math.abs(over) <= knee) outDb = levelDb + ((1 / ratio - 1) * (over + knee / 2) ** 2) / (2 * knee) // soft knee
        else outDb = threshold + over / ratio // above the knee: constant ratio
        const targetDb = Math.min(0, outDb - levelDb)
        this.grDb += (targetDb - this.grDb) * (targetDb < this.grDb ? attackCoeff : releaseCoeff)
        const gain = 10 ** (this.grDb / 20) * makeup
        for (let c = 0; c < channels; c++) output[c][i] = input[c][i] * gain
      }
    }

    // Report gain reduction ~20 times a second for the meters.
    this.sinceReport += frames
    if (this.sinceReport >= sampleRate / 20) {
      this.sinceReport = 0
      this.port.postMessage(this.grDb)
    }
    return true
  }
}
registerProcessor('compressor', Compressor)
