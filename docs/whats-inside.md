# What is inside

[← Documentation](README.md)

WING Trainer is an **Electron** app written in **TypeScript** and bundled with **esbuild**. The pure logic is kept apart from the screen so it can be unit-tested.

## The folders

```
src/
  main/index.ts          the window, the file dialogs, two dev hooks
  preload/index.ts       the small, safe bridge between the window and the files
  shared/                pure code (no screen, no audio), unit-tested
    model.ts             the types: channels, buses, mains, ports
    snapshot.ts          reads a WING snapshot into the model
    convert.ts           console values -> audio parameters
    curves.ts            EQ response, gate and compressor curves
    fader.ts             the fader's travel (also used by the meters)
    checks.ts            trouble spots in the settings
    diff.ts              the list of changes against the snapshot
    multitrack.ts        which recorded track plays on which channel
    flow.ts              the signal-flow graph and the path through it
    duplicate.ts         copies a channel to a free channel number and a new input
  renderer/
    app.ts               the screen: strips, knobs, graphs, dialogs, meters
    engine.ts            the audio graph
    routing.ts           the Routing tab
    index.html           layout and styles
    gate-worklet.js      the gate (from PreStreamer's mixer)
    comp-worklet.js      the compressor (from PreStreamer's mixer)
fixtures/sample.snap.json   an anonymised sample setup
tests/                   unit tests of src/shared
scripts/e2e-engine.mjs   measures the sound of the sample setup offline
build/                   the icon
.github/workflows/       CI and the release
```

## From a snapshot to a model

A WING snapshot is a JSON file; the part that matters is `ae_data`. `snapshot.ts` reads:

| In the snapshot | In the model |
|---|---|
| `ch` (channels): `name`, `col`, `in.conn` (the input port), `in.set.trim`, `mute`, `fdr`, `pan`, `flt`, `eq`, `gate`, `dyn`, `send`, `main` | `Channel`: name, colour, source, trim, mute, fader (dB), pan, filters, EQ, gate, compressor, sends, mains |
| `bus`: `name`, `mute`, `fdr`, `main`, `send` (the `MX1`… keys are matrix sends) | `Bus` |
| `main`, `mtx` | `Main`, `Matrix` |
| `io.in`: the ports with their name, preamp gain, phantom power | `InputPort` |
| `io.out`: what each output port is patched to | `OutputPatch` (ports set to OFF are left out) |

The reader is tolerant: a missing field gets a neutral value, so a snapshot from other firmware opens. A file with no channels is refused. The compressor's `ratio` is a number or text such as `"4:1"`; the knee (0 to 5 in the file) becomes dB (×4); the gate's attack, hold and release are in ms.

Only what the app shows or plays is read. Effects, DCA groups, layers and the other settings are ignored (and never written: the app does not save snapshots).

## The audio graph

`engine.ts` builds a Web Audio graph from the model. For each channel:

```
source -> trim -> low cut -> high cut -> six EQ bands -> gate -> compressor -> [pre tap] -> fader -> pan -> [post tap]
```

- The **gate and compressor** are audio worklets (`gate-worklet.js`, `comp-worklet.js`), copied from PreStreamer's mixer: a downward gate with threshold, range, attack, hold and release, and a feed-forward compressor with a soft knee and make-up gain.
- **Sends** are gain nodes taken from the pre tap or the post tap, as the snapshot says, into the buses. The **main sends** and a **solo send** come off the post tap.
- A **bus** sums its sends, goes through its fader and mute, and feeds the mains and the matrices.
- One **monitor** node plays what LISTEN selects (or the solo bus while a channel is soloed).
- `apply(snapshot)` sets every parameter and is cheap, so the screen calls it after each edit; only a change of structure (a new snapshot, a switch between PRE and POST) rebuilds the graph.
- The engine works on any audio context, so the test renders the graph in an `OfflineAudioContext`.

Without a recording each channel plays a generated **test signal**: noise in bursts, different per channel, so the gate and compressor have something to work on.

## Placing a recording

The console's USB recorder writes one track per recorder output. The snapshot says which input each recorder output takes (`io.out.USB`), and which channels listen to that input (`in.conn`). `multitrack.ts` uses both:

1. the number at the end of the file name is the recorder track;
2. the track's input is looked up in the USB output patch;
3. every channel whose source is that input plays the track (two channels can share one receiver).

When the routing is edited in the Routing tab, this is done again, so a track follows its input from fader to fader.

## Copying a channel

`duplicate.ts` clones a channel (a deep copy, so the two are independent), gives it the lowest free channel number (the console has 40), the new input and a name, and marks it `copyOf` the original. The screen puts it next to the original on the faders, rebuilds the audio graph and the Routing tab, and the change list reports it as added. Because a recording is placed by input (see above), a track recorded on that input plays on the copy as well.

## The Routing tab

`flow.ts` turns the model into a graph: nodes for input ports, channels, buses, mains, matrices and output ports, and edges for the input of a channel, a main assignment, a bus send (only if it is on and above off), a bus feeding a main or a matrix, and an output patch (including an input passed straight to an output, as for the recorder tracks). `trace` follows the edges both ways from a node. `routing.ts` draws the nodes in four columns, the edges as curves in an SVG layer, and the two tables that edit the model in place.

## The screen

`app.ts` builds the strips (one `Fader` description serves channels, buses, mains and matrices), the selected channel's sections, the rotary knobs (`knob()`: drag, wheel, keys, double-click to reset), the canvas graphs, the dialogs and the meters. `fader.ts` gives the fader travel; the meters and the dB scale use the same one. The channel colours are the console's twelve.

## Tests

| What | How | Where |
|---|---|---|
| The snapshot reader, conversions, curves, fader travel, checks, change list, recording placement, the flow graph | unit tests (Vitest), against an anonymised sample | `tests/` |
| The sound: faders, mute, sends, the gate, the compressor, EQ, low cut, solo, the matrix | the real app page renders the sample offline and the level is measured | `scripts/e2e-engine.mjs` (`npm run e2e`) |

Not verified: how it sounds by ear against a real console, a real recording decoded in the app, and the Windows and Linux builds.

## Builds and releases

`npm run package` makes the installer of the computer you are on (macOS `.dmg` and `.zip`, Windows setup `.exe` and `.zip`, Linux `.AppImage` and `.deb`). `.github/workflows/ci.yml` runs the type check, the tests and the build on all three systems for every push, and the sound check on Linux. `.github/workflows/release.yml` builds the installers on macOS (Apple silicon and Intel), Windows and Linux when a version tag is pushed (`npm version patch && git push --follow-tags`) and attaches them to a GitHub release. The builds are unsigned.

## Dev hooks

- `WING_TRAINER_EVAL="js"` runs JavaScript in the page, prints `EVAL <json>` and quits (used by the sound check).
- `WING_TRAINER_SHOT=file.png` (optionally `WING_TRAINER_SHOT_JS` first, and `WING_TRAINER_SIZE=1280x720`) saves a picture of the window.

## Privacy

A real snapshot holds the names of people and the console's serial number: it is never committed (`*.snap` is ignored), and the sample in `fixtures/` was made anonymous. The app reads files you choose and sends nothing anywhere.
