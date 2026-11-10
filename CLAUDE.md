# CLAUDE.md

WING Trainer: an Electron + TypeScript practice console for a Behringer WING setup (a snapshot plus a recording of a service). See README.md for what it does and how to use it.

## Commands

```bash
npm start        # build and launch
npm run build    # esbuild -> dist/
npm run typecheck
npm test         # vitest: tests/*.test.ts (pure code in src/shared)
npm run e2e      # builds, renders the sample setup in an OfflineAudioContext inside the real app page, and measures the sound
```

Dev hooks of the main process: `WING_TRAINER_EVAL="js"` runs JS in the page, prints `EVAL <json>` and quits (the window stays hidden); `WING_TRAINER_SHOT=file.png` (with optional `WING_TRAINER_SHOT_JS`) takes the picture for the README.

## Architecture

- `src/shared`: model and pure logic. `snapshot.ts` (tolerant reader of the console's JSON; unknown or missing fields get neutral values), `convert.ts` (console value -> audio parameter), `checks.ts`, `diff.ts`, `multitrack.ts` (recorder track n -> input via `io.out.USB` -> channels patched to that input).
- `src/renderer/engine.ts`: the Web Audio graph. Channel: trim -> low cut -> high cut -> 6 EQ biquads -> gate worklet -> compressor worklet -> pre tap -> fader -> pan -> post tap; sends tap pre or post, main sends and a solo send come off the post tap; buses sum into a fader and feed mains and matrices; one monitor node plays what is listened to (or the solo bus). `apply(snapshot)` sets every parameter and is cheap, so the screen calls it after each edit; only a change of structure (a pre/post switch, a new snapshot) calls `build`.
- `gate-worklet.js` and `comp-worklet.js` are copied from PreStreamer's mixer (`src/renderer/`).
- `src/renderer/app.ts`: the screen (strips, detail tabs, dialogs, meters).

## Constraints

- A real snapshot holds names of people and the console's serial number: never commit one (`*.snap` is ignored). The sample in `fixtures/` is anonymised; keep it that way.
- The trainer never writes a snapshot or talks to a console.
- Not verified: the sound by ear against a real console, a recording decoded in the app (only the offline test signals were measured), Windows and Linux.
