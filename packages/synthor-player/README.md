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
// A cue asked for mid hand-over replaces the one not yet heard, or follows the one taking over.
music.queue([                              // each step once the one before sounds:
  { cue: 'fill', timing: { every: 16 } },  //   a fill on the next bar,
  { cue: 'stage', timing: 'end', resume: true },  // then the stage back, where it would
])                                         //   have been had it played on (else from its top)

music.setTrackMuted(3, true)              // layering: Track #3 in every pattern
music.setTrackLevel(10, 0, 4)             // fade Track #10 out over 4 s (and back in with 1)
music.setInstrumentLevel('Drums', 0.5)    // instrument by name or id
music.noteOn('Lead', 72); music.noteOff('Lead', 72)  // stingers on song instruments
music.playNote('Lead', 76, { at: 'beat', delayRows: 1, rows: 2 })  // heard on the beat (±a few ms)
music.setTempo(140)                       // live change; the next load resets it
music.setVolume(0.8)
music.onCue((cue) => console.log('now playing', cue))
music.onRow(({ cue, row }) => { /* every row change, a few ms late */ })

// Animations in time with the music: read the position every frame.
const pos = music.position()              // { cue, row, beat, beatPhase, beatInBar, bar, barPhase } or null
const wait = music.timeUntil('beat')      // seconds until the next beat is heard
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
- **The music clock** follows what is *heard*: row events pin down where row
  boundaries fall (within ~5 ms after a few seconds), and output latency is
  taken off. `beatsPerBar` (option, default 4) sets the bars.
- **Shared audio**: pass `audioContext` (and optionally `destination`) to play
  through a game engine's context, e.g. Phaser's `game.sound.context`.

## Conducting a song from a game

`GameConductor` plays a song the way a game asks, from the song's game
settings (`GameMusic`): sections chosen by energy, a DJ that plays with each
one for a good while (fading parts, swapping them, cutting the drums for a
phrase), moods such as menu or danger, fills, drops and stingers. The game
only reports what happens:

```ts
import { GameConductor, SongPlayer, type GameMusic } from 'synthor-player'

// a song saved with game settings carries them: music.game (null without)
const conductor = new GameConductor(music /* a SongPlayer */, music.game ?? (settings as GameMusic))

conductor.setMood('menu')                 // a mood's cue; 'play' is the song's sections
conductor.setMood('play')                 // from a mood that doesn't return: through the intro
conductor.setProgress(level, progress)    // lifts the energy over a level (progress 0..1)
conductor.reaction(nr, sets)              // a cascade's nr-th reaction: a climbing stinger, a fill on long ones
conductor.levelUp(level)                  // a fill into a new, sparser section
conductor.key(index)                      // a climbing note per collected key
conductor.stinger('unlock')               // any stinger by name
conductor.nudge()                         // the player did something: a section past its time moves on
conductor.drop('penalty', 0.5)            // cut a drop's tracks until the next bar
conductor.setMood('danger')               // a mood that `returns`: play carries on after it
conductor.setMood('blast')                // a mood with a `hit`: it cuts in at once, then the mood's cue
conductor.setEnabled(false)               // silent (a music setting)
conductor.snapshot()                      // section, the DJ's visit, energy… for a readout
conductor.position()                      // the music clock while it plays
```

Sections and moods name cues; stingers name instruments; the DJ's `groups`
map part names to Track numbers. Randomness defaults to `Math.random`: pass
your own (`{ random }`) but never a game's seeded random.
