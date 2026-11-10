# WING Trainer

A practice console for a **Behringer WING** setup. Open a snapshot saved from the console and a recording of a service, and try the mix on a screen laid out like the console's (colour-coded channel strips with the name tag at the bottom, a fader with its dB scale and segmented meter, rotary knobs, and EQ, gate and compressor graphs): move faders, change the EQ, the gate and the compressor, build a monitor or stream mix, and hear what it does. Nothing is sent to a real console.

![WING Trainer with the sample setup](docs/main.png)

It is made for **testing the Sunday setup** before Sunday, and for practising without touching the console. It is a simulator, not the WING's own software, and its sound is close to the console's but not identical (see *What is simulated*).

## Run it

```bash
npm install
npm start          # builds, then opens the app
npm test           # unit tests of the snapshot reader, the checks and the rest
npm run e2e        # renders the sample setup offline and measures the sound (needs a display)
```

Node 22 or newer. The app starts with an **anonymised sample setup** (a preacher, two wireless microphones, five singers, piano, cajon, bass and guitar) playing test signals, so it works at once.

## How to use it

1. **Open snapshot…** loads a `.snap` file saved by the console (JSON). Your own snapshot stays on your computer and is never copied anywhere; `*.snap` files are ignored by git.
2. **Open recording…** loads a folder of tracks from the console's **USB recorder** (multitrack). Name the files like `Track 03.wav`: the number is the recorder track. The snapshot says which input each recorder track took, and which channels are patched to that input, so every track lands on the right channel by itself. The app tells you what it placed and what it could not.
   - A single file can be played on any channel with **Play a file on this channel…** (for example a stereo mix on a playback channel).
   - Decoded audio takes a lot of memory: use an excerpt of two to ten minutes, and files up to 200 MB.
3. **Play** starts every channel together and loops them. **Listen to** chooses what the speakers get: a main, a bus (a monitor mix or the stream mix) or a matrix. **S** (solo) listens to that channel alone.
4. Click a channel to see its settings below: **input** (trim, pan, low and high cut), **gate** and **dynamics** with their curves, a six-band **EQ** with its response curve, and its **sends** (to the buses and the mains, pre or post fader). Turn a knob by dragging it up or down (hold Shift for fine steps), with the wheel or the arrow keys; double-click to put it back. **CHANNELS / BUSES** switches the strips between the channels and the buses; the mains and the matrix are always on the right (LISTEN plays one).
5. **Checks** lists trouble spots found from the settings (a gate that opens too fast, a compressor without make-up gain, a fader pushed up, a channel that goes nowhere). **Changes** lists everything you changed against the snapshot, in words, so you can make the same changes on the console (the trainer does not write snapshots). **Reset** goes back to the snapshot.

## What is simulated

| Console | Here |
|---|---|
| Input trim, low cut, high cut | yes |
| Six-band EQ (low and high shelf or bell, four bells) | yes, with standard filters |
| Gate (threshold, range, attack, hold, release) | yes |
| Compressor, the `COMP` model (threshold, ratio, knee, attack, release, make-up) | yes |
| Fader, mute, pan, solo | yes |
| Sends to buses (pre or post fader), assignment to mains, bus to matrix | yes |
| Other dynamics models (limiters, N-STR ...), effects (reverb, delay ...), bus EQ and dynamics, DCA groups, input preamps, the console's own layers and screens | **not yet**: shown, but the signal passes through |

The sound comes from the standard Web Audio filters and from the gate and compressor of [PreStreamer](https://github.com/AC-Dubnica/prestreamer)'s mixer. They behave like the console's but are not Behringer's algorithms, so use this to learn what a setting does and to compare settings, not to match the room to the decibel.

## How it is built

Electron and TypeScript, bundled with esbuild.

- `src/shared`: pure code, unit-tested. `snapshot.ts` reads a snapshot into the model in `model.ts`; `convert.ts` turns console values into audio parameters; `checks.ts` finds trouble spots; `diff.ts` lists changes; `multitrack.ts` places recorder tracks on channels.
- `src/renderer/engine.ts`: the audio graph (a Web Audio context that can also be an `OfflineAudioContext`, which is how `scripts/e2e-engine.mjs` measures it). `app.ts` is the screen.
- `fixtures/sample.snap.json`: the anonymised sample, cut down from a real snapshot (names changed, no serial number).

## Not in this version

Lessons with goals and hints, fault drills, effects, the console's layers and DCA groups, and other languages (English only for now). The look follows the WING's from memory and from its documentation, not from its own software, so colours and layout are close but not exact.
