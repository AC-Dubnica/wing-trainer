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
    session.ts           what is remembered between runs (window, folders, where the work ended)
    connect.ts           makes and removes a connection between two nodes of the diagram
    duplicate.ts         copies a channel to a free channel number and a new input
    mixes.ts             adds, renames and removes buses and matrices
    export.ts            writes the edits back into the snapshot file
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

## Connections in the diagram

`connect.ts` turns a pair of diagram nodes into a change of the snapshot (`connect`) or its opposite (`disconnect`): a channel takes an input port, a channel or bus is assigned to a main, a channel sends to a bus, a bus sends to a matrix, an output carries a main, bus, matrix or input. The pair can be named in either order (it works out which one feeds the other); things of the same kind, and pairs that cannot be connected directly, are refused with a message. `toggleConnection` is the one gesture: if a line is drawn between the two (`isConnected`, from the flow graph) it disconnects them, otherwise it connects them. `routing.ts` calls it for ⌘-click (Ctrl on Windows and Linux) on another node and on a line (each line has a wide invisible copy to click). Making the view again keeps the scroll of both sides and the box that was in use, so a change in a table does not jump to the top.

## Copying a channel

`duplicate.ts` clones a channel (a deep copy, so the two are independent), gives it the lowest free channel number (the console has 40), the new input and a name, and marks it `copyOf` the original. The screen puts it next to the original on the faders, rebuilds the audio graph and the Routing tab, and the change list reports it as added. Because a recording is placed by input (see above), a track recorded on that input plays on the copy as well.

## Saving a snapshot

`export.ts` writes the edits back into the snapshot file the app read. It keeps the original JSON (the screen holds the raw file next to the model), compares the snapshot as it was loaded with the edited one, and writes only the values that differ, at the places they were read from and in the file's own units: a shelf flag becomes `SHV` or `PEQ`, the compressor's knee goes from dB back to the file's 0 to 5, a ratio written as text (`"4:1"`) stays text, an off input is `OFF`. A copied channel gets a clone of the original strip in a free slot first; a new bus or matrix is written into its slot; a removed one is emptied (no name, assigned to nothing, sends off); an output that is no longer patched goes back to `OFF`. Everything else in the file is left alone. The main process saves it under a new name (it refuses the name of the file that was opened) and puts a list of the changes beside it.

The tests check that an unedited export equals the original, that one edit changes exactly one path, and that reading an exported file back gives the edited snapshot; the same checks were run on a real snapshot. What has not been done is loading an exported file on a console.

## Buses and matrices

`mixes.ts` finds the lowest free bus (16) or matrix (8) number and adds or removes one in the model. A new bus has every channel's send to it switched off (a slot that was empty in the snapshot may still hold old values, so they are cleared), no main assignment and no matrix send; removing one switches the sends to it off and takes the output ports that carried it out of the patch. The screen makes everything again afterwards (the strips, the panel, the Routing tab, the audio graph), and the change list reports the additions, renames and removals.

## The Routing tab

`flow.ts` turns the model into a graph: nodes for input ports, channels, buses, mains, matrices and output ports, and edges for the input of a channel, a main assignment, a bus send (only if it is on and above off), a bus feeding a main or a matrix, and an output patch (including an input passed straight to an output, as for the recorder tracks). `trace` follows the edges both ways from a node. `routing.ts` draws the nodes in four columns, the edges as curves in an SVG layer, and the two tables that edit the model in place.

## The screen

`app.ts` builds the strips (one `Fader` description serves channels, buses, mains and matrices), the selected channel's sections, the rotary knobs (`knob()`: drag, wheel, keys, double-click to reset), the canvas graphs, the dialogs and the meters. `fader.ts` gives the fader travel; the meters and the dB scale use the same one. The channel colours are the console's twelve.

## What is remembered

`src/main/index.ts` keeps `session.json` in the user's data folder: the window (its size and place when not maximized, and whether it was maximized), the folder each file dialog used last, the path of the open snapshot, and a block of "work state" that the screen hands over. `src/shared/session.ts` reads it defensively (`sanitizeSession`: anything that is not right is dropped) and checks that a saved window position is on a screen that still exists (`isVisible`). The file is written a moment after the last change, through a temporary file that replaces the old one, so it is never left half written. The window opens maximized when nothing is saved.

A saved model may come from an older version of the app, so `ensureModel` (in `snapshot.ts`) fills in what later versions added before anything uses it, and if restoring fails altogether the snapshot opens as it is. The work state (`WorkState` in `app.ts`) is the edited snapshot model, the fader order, the selection, the tab and layer, what is listened to and the recording folder. At start the screen asks the main process for the session, opens the snapshot file again, and, if the saved state belongs to that same file (and its channels fit it), puts the state back on top. A file that has gone, or a state from another version, is simply not used.

## Tests

| What | How | Where |
|---|---|---|
| The snapshot reader, conversions, curves, fader travel, checks, change list, recording placement, the flow graph | unit tests (Vitest), against an anonymised sample | `tests/` |
| The sound: faders, mute, sends, the gate, the compressor, EQ, low cut, solo, the matrix | the real app page renders the sample offline and the level is measured | `scripts/e2e-engine.mjs` (`npm run e2e`) |
| The Routing tab: tables keep their place, ⌘-click connects or, when already connected, disconnects (on a node and on a line) | the real app, with the clicks made by a script | `scripts/e2e-routing.mjs` (`npm run e2e`) |
| Saving a snapshot: unedited = identical, one edit = one path, read back = what was edited, copies, buses and matrices | unit tests (and the same checks on a real snapshot, by hand) | `tests/export.test.ts` |
| What is remembered: the snapshot file, the window, the edits, the selection, the tab | the real app is run twice on a scratch data folder (`WING_TRAINER_USER_DATA`) and the second run must find everything as it was left | `scripts/e2e-session.mjs` (`npm run e2e`) |

Not verified: how it sounds by ear against a real console, a real recording decoded in the app, and the Windows and Linux builds.

## Builds and releases

`npm run package` makes the installer of the computer you are on (macOS `.dmg` and `.zip`, Windows setup `.exe` and `.zip`, Linux `.AppImage` and `.deb`). `.github/workflows/ci.yml` runs the type check, the tests and the build on all three systems for every push, and the sound check on Linux. `.github/workflows/release.yml` builds the installers on macOS (Apple silicon and Intel), Windows and Linux when a version tag is pushed (`npm version patch && git push --follow-tags`) and attaches them to a GitHub release. The builds are unsigned.

## Dev hooks

- `WING_TRAINER_USER_DATA=folder` uses that folder for the app's data (so a test can try the remembering without touching the real one); without it the hooks below never read or change what the app remembers.
- `WING_TRAINER_EVAL="js"` runs JavaScript in the page, prints `EVAL <json>` and quits (used by the sound check).
- `WING_TRAINER_SHOT=file.png` (optionally `WING_TRAINER_SHOT_JS` first, and `WING_TRAINER_SIZE=1280x720`) saves a picture of the window.

## Privacy

A real snapshot holds the names of people and the console's serial number: it is never committed (`*.snap` is ignored), and the sample in `fixtures/` was made anonymous. The app reads files you choose and sends nothing anywhere.
