# synthor-player

Plays [synthor](../../README.md) songs outside the editor — for games and
embeds. One self-contained ES module (Elementary + the txSeq sequencer wasm),
no React, no storage. Build it from the synthor root:

```bash
npm run build:player   # → packages/synthor-player/dist
```

Consume it like synthor consumes its vendored Elementary renderer: copy
`packages/synthor-player` (with `dist/`) into the host project, e.g.
`vendor/synthor-player`, and depend on it with
`"synthor-player": "file:vendor/synthor-player"`.

## Use

```ts
import { SongPlayer } from 'synthor-player'

const music = new SongPlayer()            // plays each song at its saved tempo
await music.load(await (await fetch('/audio/theme.synthor')).arrayBuffer())

// From a user gesture (autoplay policy):
await music.start()
await music.play('calm')                  // a section or pattern, by name or id

music.cue('danger', 'end')                // when the current loop finishes
music.cue('danger', { every: 16 })        // on the next 16-row boundary (a bar)
music.cue('danger-alt', 'sync')           // swap now, keeping the position
music.cue('game-over', 'now')             // restart on the new cue

music.setTrackMuted(3, true)              // layering: Track #3 in every pattern
music.setInstrumentLevel('Drums', 0.5)    // instrument by name or id
music.noteOn('Lead', 72); music.noteOff('Lead', 72)  // stingers on song instruments
music.setTempo(140)                       // live change; the next load resets it
music.setVolume(0.8)
music.onCue((cue) => console.log('now playing', cue))
music.onRow(({ cue, row }) => { /* sync visuals to the beat */ })
music.stop()
```

- **Cues** are sections or patterns (`music.cues` lists them); `{ song: true }`
  plays every section in order. A section name wins over a pattern name.
- **Hand-overs are seamless**: the sequencer keeps running and the next cue's
  rows are spliced in ahead of the playhead, so nothing restarts or drifts.
  A switch is scheduled ~100 ms ahead to cover event and upload latency.
- **Layers** are Track numbers, as in the editor's F-key mutes: keep a part
  on the same track position in every pattern to fade it in and out. Mutes
  are smoothed, so they don't click.
- **Stingers** play through the instrument's tracker slots, so the instrument
  needs at least one track in the song.
- **Shared audio**: pass `audioContext` (and optionally `destination`) to play
  through a game engine's context, e.g. Phaser's `game.sound.context`.
