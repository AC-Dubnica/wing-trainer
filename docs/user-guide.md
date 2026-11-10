# User guide

[← Documentation](README.md)

## Start

Run the app (`npm start`, or install a release). It opens with an **anonymised sample setup**: a preacher, two wireless microphones, five singers, piano, cajon, bass and guitar, each playing a test signal. Press **PLAY** and you hear it.

The top bar:

| Control | What it does |
|---|---|
| **CONSOLE / ROUTING** | The two views of the app (see below). |
| **CHANNELS / BUSES** | In the Console view: which strips are shown on the left, the channels or the buses. |
| **PLAY / STOP** | Starts or stops every channel together (they loop). |
| **LISTEN** | What the speakers play: a main, a bus (a monitor mix, the stream mix) or a matrix. The small meter next to it shows its level. |
| **SNAPSHOT…** | Opens a snapshot file from the console. |
| **RECORDING…** | Opens a folder with a multitrack recording. |
| **TEST SIGNALS** | Goes back to a test signal on every channel. |
| **CHECKS** | Trouble spots found in the settings (the number is how many). |
| **CHANGES** | Everything you changed against the snapshot, in words (the number is how many). |
| **RESET** | Back to the snapshot as it was loaded. |

The bottom line says what was loaded, what a recording placed where, or why something failed. On the right it names the snapshot and whether test signals or a recording are playing.

## Open your own snapshot

1. On the console, save a snapshot to the USB stick (the file ends in `.snap`).
2. **SNAPSHOT…** and choose it. The app reads the channels, buses, mains, matrix, the input and output patching and the settings of every channel.
3. A snapshot from another firmware also opens: whatever the app does not know gets a neutral value.

Your snapshot stays on your computer. It holds the names of people and the console's serial number, so do not put it in a public repository (`*.snap` files are ignored by git here).

## Open a recording

**RECORDING…** takes a **folder** of tracks from the console's USB recorder, one file per track, named like `Track 03.wav` (or `03.wav`, `ch12.flac`): the last number in the name is the recorder track.

The snapshot says which input each recorder track took, and which channels listen to that input, so each track lands on the right channel by itself. The bottom line lists what was placed and what was not (for example a file with no number in its name, or a track nothing is patched to).

- **Play a file on one channel:** select the channel and press *Play a file on this channel…* (for example a stereo mix on a playback channel).
- **Size:** decoded audio takes a lot of memory. Use an excerpt of two to ten minutes and files up to 200 MB each.
- **Formats:** wav, flac, mp3, ogg, aiff, m4a.

## The Console view

**Strips.** Each channel has a strip like the console's: its number and input at the top (`13 C2`), small **G E D** lights that are lit when the gate, EQ and dynamics are on, a fader with a dB scale and a segmented meter, the level in dB, **MUTE** and **SOLO**, and the channel's name in its colour at the bottom. The numbers `G -25` and `C -6` above the fader are the gate and compressor working (dB of reduction) while playing.

- **Fader:** drag it. Its travel spends more of its length near 0 dB, like the console's. All the way down is off (-∞).
- **SOLO** plays that channel alone, whatever LISTEN says. **MUTE** silences it.
- Click a strip to select it; the panel below shows its settings.
- **Mains and matrix** (PA, SUB, HALL SPEAKERS in the sample) are always on the right. **LISTEN** on one plays it.
- **BUSES** shows the buses on the left instead of the channels: fader, mute and LISTEN, so you can hear a monitor mix.
- The mouse wheel scrolls the strips sideways when there are more than fit.

**Selected channel.** Below the strips, in sections:

- **Input:** trim, pan, and the low and high cut with their frequencies.
- **Gate:** on/off, a graph of its curve (the dashed line is the threshold), threshold, range, attack, hold, release.
- **EQ:** on/off, the frequency response curve with a dot for each of the six bands, and for each band gain, frequency and Q.
- **Dynamics:** on/off, the compressor's curve, threshold, ratio, knee, attack, release and make-up gain. Only the `COMP` model is simulated; for the others (limiters, N-STR) it says so and the signal passes.
- **Sends:** whether the channel goes to each main and each bus, how much, and whether the tap is before the fader (PRE) or after it (POST).

**Knobs.** Drag a knob up or down to turn it (hold **Shift** for fine steps), or use the mouse wheel, or click it and use the arrow keys. **Double-click** puts it back to the value it had when the snapshot was loaded. A greyed knob belongs to a section that is switched off.

**Copy a channel to a new input.** With a channel selected, **COPY TO A NEW INPUT…** (top right of its panel) makes a copy of the whole strip: EQ, gate, compressor, filters, trim, fader, pan, mute, the sends to buses and the assignments to mains. You choose the input the copy listens to (a group such as `C` and a port; the app suggests the next port nobody uses) and its name. The copy takes the lowest free channel number (the console has 40) and stands next to the original on the faders. It is independent: changing it does not change the original. If a recording is open, the track recorded on that input plays on the copy. The copy shows in **CHANGES** (`Ch 4 SINGER 1 copy: Added - -> copy of Ch 13, input C 10`) and **RESET** removes it.

![The copy dialog](copy.png)

## The Routing view

**ROUTING** shows how the whole venue is organised, drawn from the snapshot. Four columns, left to right:

1. **Inputs:** the input ports that are used (stage box, the aux input, USB, the player), with the name the snapshot gives each port.
2. **Channels,** in fader order.
3. **Mixes:** buses, mains and the matrix.
4. **Outputs:** the patched output ports (stage box outputs, aux, the USB and card recorder tracks, AES/EBU, the recorder).

The lines show the signal: blue to a main, amber a bus send, purple to a matrix, green to an output, grey from an input. A dashed line is a muted channel or bus.

**Follow a signal.** Click any item: its whole path lights up, both ways (where the signal comes from, and every output it reaches). The item you clicked has a **white** outline, every other input, channel (fader), mix and output on its path an **amber** outline, and everything else fades. A line above the diagram lists the path in words, by column (inputs, channels, mixes, outputs). Click the item again to clear. Bus sends are drawn only for the clicked path, or all of them with **show all bus sends**.

**Remap, without a console.** The two tables on the right change the routing in the app:

- **Faders and inputs:** the ▲ ▼ buttons move a channel to the left or right in the order of the faders. The **Input** boxes change which port the channel listens to (a group such as `C`, `AUX`, `USB`, and a port number). With a recording open, the tracks follow at once: a channel that now listens to another input plays the track recorded on that input.
- **Outputs:** each patched output port shows its source (a main, matrix, bus, the console monitor, or an input passed straight through). Change it, unpatch it with ×, or patch another port at the bottom with **PATCH**. The USB outputs are the recorder tracks, so changing them changes which recorded track plays on which fader.

The order of the faders is a trainer feature: it is not the console's own layer setting.

## Checks and Changes

**CHECKS** lists trouble spots the settings suggest. They are hints, not verdicts:

- a gate with an attack under 5 ms (it can click on a voice),
- a compressor without make-up gain (the channel gets quieter when it works),
- a fader above +5 dB (raise the gain at the source instead) or very low,
- a channel that goes nowhere (no main, no bus),
- a muted channel with pre-fader sends on.

**CHANGES** lists everything that differs from the snapshot, one line each, for example:

```
Ch 13 SINGER 1: Gate attack 10 ms -> 20 ms
Ch 13 SINGER 1: Input C 2 -> C 5
Output C 7: Source MAIN 1 -> MAIN 2
Fader order: PREACHER, SINGER 1, WIRELESS 1, ...
```

**COPY** puts the list on the clipboard. The trainer does **not** write snapshots: to use a result, make the same changes on the console. **RESET** goes back to the snapshot.

## What the app remembers

The app opens where you left it:

- **The window:** it opens **maximized** the first time. After that it comes back in the size and place you left it, and maximized again if you closed it maximized. A window left on a screen that has been unplugged is moved back onto a screen.
- **The snapshot:** the file you had open is opened again by itself (read from the file, so a changed file shows its new content). If the file is gone, the sample opens.
- **Your work:** your edits (faders, knobs, copied channels, remapped inputs and outputs), the order of the faders, the selected channel, the open tab (Console or Routing), CHANNELS or BUSES, and what you listen to. The bottom line says "Back where you left off" and how many changes you have. **RESET** still goes back to the snapshot as it was loaded.
- **The recording:** the folder you opened is opened again and its tracks are read again (this can take a moment for a large recording). If the folder has gone, the channels play test signals. A file played on a single channel is not remembered.
- **The folders of the dialogs:** the snapshot, recording and audio file dialogs open in the folder you used last time.

All of it is kept in `session.json` in the app's data folder (on macOS `~/Library/Application Support/wing-trainer`, on Windows `%APPDATA%\wing-trainer`, on Linux `~/.config/wing-trainer`). Delete that file to start fresh.

## Good to know

- The sound is a **simulation**. The EQ uses standard filters; the gate and compressor behave like the console's but are not Behringer's algorithms. Use it to learn what a setting does and to compare settings, not to match a room to the decibel.
- **Not simulated yet:** effects (reverb, delay and so on), the bus EQ and dynamics, DCA groups, the preamp, the console's own layers and screens. These are shown or ignored; the signal passes through.
- Muting a channel silences it everywhere (the real console may keep pre-fader sends alive).
- The preamp gain and phantom power in the snapshot are read but do not change the sound.

## When something does not work

| What you see | What to do |
|---|---|
| "This is not a WING snapshot" | The file has no channels. Choose the `.snap` file the console saved. |
| "None of the N files could be placed" | Name the tracks `Track 01.wav`, `Track 02.wav`... (the number is the recorder track) and check that the snapshot patches that USB track to an input. |
| A channel is silent | Is it muted (red MUTE)? Is its fader down? Does it have an input (the strip says `no input`)? Is it sent to a main, or is LISTEN set to something else? |
| "This file is too large" | Cut a shorter excerpt (under 200 MB). |
| No sound at all | Press PLAY (the app plays nothing until then) and check LISTEN and the computer's output device. |
