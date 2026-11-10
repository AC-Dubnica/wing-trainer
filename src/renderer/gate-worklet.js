// Downward-expander noise gate. Runs in AudioWorkletGlobalScope. Works on any number of channels: it listens to the loudest
// one and applies the same gain to all, so a stereo signal keeps its image (a gate can sit after a stereo effect, or on the master).
// Parameters are k-rate so the console UI can change them live. The gain it applies is reported ~20 times a second.
class Gate extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'enabled', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'threshold', defaultValue: -50, minValue: -100, maxValue: 0, automationRate: 'k-rate' },
      { name: 'range', defaultValue: 40, minValue: 0, maxValue: 90, automationRate: 'k-rate' },
      { name: 'attack', defaultValue: 5, minValue: 0.1, maxValue: 200, automationRate: 'k-rate' },
      { name: 'hold', defaultValue: 50, minValue: 0, maxValue: 2000, automationRate: 'k-rate' },
      { name: 'release', defaultValue: 200, minValue: 1, maxValue: 5000, automationRate: 'k-rate' },
    ]
  }

  constructor() {
    super()
    this.env = 0 // peak envelope of the input
    this.gain = 1 // smoothed gate gain
    this.holdLeft = 0 // samples left before the gate may close
    this.sinceReport = 0
  }

  process(inputs, outputs, params) {
    const input = inputs[0]
    const output = outputs[0]
    if (!output || output.length === 0) return true
    if (!input || input.length === 0) {
      for (const ch of output) ch.fill(0)
      return true
    }
    const channels = Math.min(input.length, output.length)
    const frames = input[0].length

    if (params.enabled[0] < 0.5) {
      for (let c = 0; c < channels; c++) output[c].set(input[c])
      this.gain = 1
    } else {
      const threshold = 10 ** (params.threshold[0] / 20)
      const floor = 10 ** (-params.range[0] / 20)
      const holdSamples = (params.hold[0] / 1000) * sampleRate
      const attackCoeff = 1 - Math.exp(-1 / ((params.attack[0] / 1000) * sampleRate))
      const releaseCoeff = 1 - Math.exp(-1 / ((params.release[0] / 1000) * sampleRate))
      const envDecay = Math.exp(-1 / (0.005 * sampleRate)) // 5 ms: fast enough to follow speech, smooth enough not to chatter

      for (let i = 0; i < frames; i++) {
        let level = 0
        for (let c = 0; c < channels; c++) {
          const v = Math.abs(input[c][i])
          if (v > level) level = v
        }
        this.env = level > this.env ? level : this.env * envDecay
        if (this.env > threshold) this.holdLeft = holdSamples
        else if (this.holdLeft > 0) this.holdLeft--
        const target = this.env > threshold || this.holdLeft > 0 ? 1 : floor
        this.gain += (target - this.gain) * (target > this.gain ? attackCoeff : releaseCoeff)
        for (let c = 0; c < channels; c++) output[c][i] = input[c][i] * this.gain
      }
    }

    this.sinceReport += frames
    if (this.sinceReport >= sampleRate / 20) {
      this.sinceReport = 0
      this.port.postMessage(Math.max(-90, 20 * Math.log10(this.gain + 1e-9)))
    }
    return true
  }
}
registerProcessor('gate', Gate)
