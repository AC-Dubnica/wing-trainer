/** The part of a Behringer WING snapshot that the trainer plays with: channels, buses, mains and matrices as plain values. */

/** Below this a level means "off" (the WING stores -144 dB for a fader or send that is all the way down). */
export const OFF_DB = -100

/** Where an input comes from on the console: a group (LCL, AUX, A, B, C, USB, ...) and the number inside it. */
export interface Source { grp: string; in: number }

export interface EqBand { gain: number; freq: number; q: number }

export interface Eq {
  on: boolean
  low: EqBand & { shelf: boolean }
  bands: [EqBand, EqBand, EqBand, EqBand]
  high: EqBand & { shelf: boolean }
}

export interface Filters {
  lowCut: { on: boolean; freq: number }
  highCut: { on: boolean; freq: number }
}

/** All times in milliseconds, levels in dB. */
export interface Gate { on: boolean; threshold: number; range: number; attack: number; hold: number; release: number }

export interface Comp {
  on: boolean
  /** The WING's own name of the dynamics model: COMP is simulated, others (limiters, N-STR ...) are shown but pass the signal. */
  model: string
  threshold: number
  ratio: number
  /** In dB (the WING stores 0 to 5). */
  knee: number
  attack: number
  release: number
  makeup: number
}

/** A send from a channel to a bus. */
export interface Send { bus: number; on: boolean; level: number; pre: boolean }

/** A channel's (or a bus's) assignment to a main. */
export interface MainSend { main: number; on: boolean; level: number }

/** The console has this many channels, buses and matrices. */
export const MAX_CHANNELS = 40
export const MAX_BUSES = 16
export const MAX_MATRICES = 8

export interface Channel {
  id: number
  /** Set on a channel made in the trainer by copying another: the channel it was copied from. */
  copyOf?: number
  name: string
  /** The console colour number, kept to group strips by colour. */
  color: number
  source: Source
  /** False when the input is patched to nothing ("OFF"): the channel is there but silent. */
  hasSource: boolean
  /** Whether the input is a stereo pair: the channel then takes this port and the next one (see `InputPort.mode`). */
  stereo: Stereo
  /** Input trim in dB. */
  trim: number
  mute: boolean
  /** Fader in dB, OFF_DB or lower = all the way down. */
  fader: number
  /** -100 (left) to 100 (right). */
  pan: number
  filters: Filters
  eq: Eq
  gate: Gate
  comp: Comp
  sends: Send[]
  mains: MainSend[]
}

export interface MatrixSend { mtx: number; on: boolean; level: number }

export interface Bus {
  id: number
  name: string
  mute: boolean
  fader: number
  mains: MainSend[]
  matrix: MatrixSend[]
}

/** A main can feed matrices, like a bus. */
export interface Main { id: number; name: string; mute: boolean; fader: number; matrix: MatrixSend[] }
export interface Matrix { id: number; name: string; mute: boolean; fader: number }

/** One recorder track: which console input the USB (or card) recorder takes as its track number `track`. */
export interface RecorderTrack { track: number; source: Source }

/** The ports of the console's input groups (LCL = local XLR inputs, AUX, A/B/C = the three AES50 ports, SC = StageConnect, USB, CRD = card, ...). */
export const INPUT_GROUPS = ['LCL', 'AUX', 'A', 'B', 'C', 'SC', 'USB', 'CRD', 'MOD', 'PLAY', 'AES', 'USR', 'OSC'] as const
/** How many ports each input group has. */
export const INPUT_PORTS: Record<string, number> = { LCL: 24, AUX: 8, A: 48, B: 48, C: 48, SC: 32, USB: 48, CRD: 64, MOD: 64, PLAY: 4, AES: 2, USR: 48, OSC: 2 }
/** How many ports each output group has. */
export const OUTPUT_GROUPS: Record<string, number> = { LCL: 8, AUX: 8, A: 48, B: 48, C: 48, SC: 32, USB: 48, CRD: 64, MOD: 64, REC: 4, AES: 2 }
/** What an output can carry: a main, a matrix, a bus, the console monitor, or an input passed straight through (any input group). */
export const OUTPUT_SOURCES = ['OFF', 'MAIN', 'MTX', 'BUS', 'MON', ...INPUT_GROUPS] as const

/** One input port of the console with the name and preamp it has in the snapshot. */
export interface InputPort {
  grp: string
  port: number
  name: string
  gain: number
  phantom: boolean
  /** M = mono, ST = stereo (this port and the next one are left and right), M/S = a mid and a side microphone. */
  mode: string
}

/** How a channel takes its input: null = one mono port; ST = a stereo pair of ports (left, right); MS = a mid and side pair. */
export type Stereo = 'ST' | 'MS' | null

/** What an output port is patched to (`source.grp` OFF = nothing). */
export interface OutputPatch { grp: string; port: number; source: Source }

export interface Snapshot {
  /** When and with which firmware the console saved it, if it says. */
  created: string
  firmware: string
  channels: Channel[]
  buses: Bus[]
  mains: Main[]
  matrices: Matrix[]
  /** For each of the four mains (index 0 = main 1): whether it is mono. A stereo main is two signals in the output patch, a left and a right. */
  mainMono: boolean[]
  /** Input ports that have a name in the snapshot. */
  inputs: InputPort[]
  /** The patched outputs (those set to OFF are left out). */
  outputs: OutputPatch[]
}
