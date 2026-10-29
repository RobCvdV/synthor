# synthor — Game audio

> Plan for songs that a game drives: stages, fills, layers and stingers on cue,
> with animations in time with the music. First target: Zwap
> (`RobCvdV/zwap-phaser-react`), which plays songs through the headless
> `SongPlayer` (`src/headless/`, built as `packages/synthor-player`).

## Status

The player side of phases 1–3 is built; Zwap conducts a song with it. How
Zwap uses it (sections, a DJ that plays with each section, energy, stingers,
beat-synced visuals), the score's contract and the **current backlog** are in
Zwap's [`docs/MUSIC.md`](https://github.com/RobCvdV/zwap-phaser-react/blob/main/docs/MUSIC.md).
The open items for this repo are marked below: sound-effect instruments and a
cost benchmark (phase 1), chord changes (phase 3), the C++ sequencer work
(phase 4) and the Game screen (phase 5).

**`SongPlayer` API** (see `packages/synthor-player/README.md`): `load`,
`start`, `play(cue)`, `cue(cue, timing)` (`'now' | 'sync' | 'end' | { every }`),
`queue(steps)` with `resume`, `setTrackMuted` / `setMutedTracks`,
`setTrackLevel(track, level, fadeSeconds)`, `setInstrumentLevel`, `setTempo`,
`setVolume`, `noteOn` / `noteOff`, `playNote(instrument, note, { at, delayRows,
rows, velocity })`, `position()`, `timeUntil('row' | 'beat' | 'bar')`,
`onRow`, `onCue`. Cue logic is pure in `src/player/cues.ts` (hand-overs,
re-planning, resume, track levels) and `src/player/songClock.ts` (the music
clock), both with tests.

**Shipping a player change to Zwap**: `npm run build:player`, then copy
`packages/synthor-player/dist/synthor-player.js`, `dist/types/` and `README.md`
into Zwap's `vendor/synthor-player/` and write this repo's commit to its
`SYNTHOR_COMMIT`.

## Decisions

- **The audio thread keeps time, the game conducts.** The game decides *what*
  happens next (a fill, the next stage, an accent) and sends it ahead of time,
  aimed at a musical point (next beat / bar / section). `TxSeq` carries it out
  on the exact row. The game loop is not the sequencer: its frames are ~16 ms
  apart, drop on busy phones and slow down in background tabs — audible at
  125 ms per row.
- **Animations follow the music's clock**, read every frame. Visuals tolerate
  16 ms; audio doesn't.
- **One song plays at a time.** Every screen or game may load a different song
  (menu song, a pool of game songs per mode); the switch happens at a scene
  change under a short fade, since loading recompiles the graph and decodes
  samples. Two songs sounding together doubles the voices, so layering and
  variation within a game come from one song. A short crossfade between two
  players is fine.
- **Tempo belongs to the song** (`doc.tempo`: `bpm`, `linesPerBeat`, schema
  v17) — done; the player plays a song at its own tempo.
- **Game authoring is a screen in the editor** ("Game", next to tracker,
  instruments, samples and mixer), shown for songs with game settings or when
  switched on. It runs the same conductor the game does, on the open song.
- **A song carries its game settings** (`doc.game`): sections with their
  energy and grammar, the DJ's parts, mood cues, fills, drops and stingers,
  referring to sections, patterns and instruments by id or name (Zwap's score
  uses names; the settings editors should write ids, so a rename keeps
  working). A game loads the song and gets the music's behaviour with it; its own code only maps game events
  (moves, cascades, level-ups, danger) to the conductor.

## Phases

### 1. Quick wins (JS) — tempo done; sound-effect instruments and the benchmark open
- ~~**Tempo in the song**~~ — done: `doc.tempo`, schema v17 (older songs load at
  120 / 4), undoable edits, the engine and `SongPlayer` read it.
- **Sound-effect instruments**: the game declares `{ instrument: voices }`;
  those get free-play voices (`liveVoiceInstIds` + `VoicePool`, no C++), with
  pan by screen position and echo / reverb sends.
- **Cost benchmark**: render a song offline in vitest and time it per
  instrument — a CPU budget per instrument for older phones.

### 2. Music clock and beat sync (JS) — done
- ~~Music clock~~ — done: `player.position()` → `{ cue, row, beat, beatPhase,
  beatInBar, bar, barPhase }` as heard (`player/songClock.ts` fits row-event
  timing, `AudioHost.outputTime` takes off output latency);
  `player.timeUntil('row' | 'beat' | 'bar')`.
- ~~In the game~~ — done in Zwap (`RhythmService`): `onBeat` / `onBar` from the
  scene's update loop. Idle effects read `beatPhase` per frame; decorative
  flourishes start on the next beat or 8th; player feedback (swap, select) is
  never delayed.

### 3. Conductor API (JS, on today's cue hand-over) — done but chord changes
- ~~Re-planned hand-overs~~ — done: a cue asked for mid hand-over replaces the
  one not yet heard, or lands on the grid of the one taking over
  (`nodeView` / `switchRow` in `player/cues.ts`) instead of waiting out its loop.
- ~~Queue~~ — done: `player.queue([{ cue: 'fill', timing: { every: 16 } },
  { cue: 'stage', timing: 'end' }])` asks for each step once the one before
  sounds, so a fill plays once and the stage comes back.
- ~~Resume~~ — done: a step with `resume: true` carries the cue on where it
  would be had it kept playing since it was left, so fills and detours stand
  in for bars of the stage instead of restarting its progression
  (`rotatePlaybackData`, `resumeRow` in `player/cues.ts`).
- ~~Timed stingers~~ — done: `player.playNote(instrument, note, { at: 'beat',
  delayRows, rows, velocity })`, sent ahead by the output latency (±10 ms until
  phase 4).
- ~~Track levels~~ — done: `player.setTrackLevel(track, level, fadeSeconds)`
  fades a Track # through the (smoothed) slot mute refs, so a game builds a
  section up and down by parts while it stays on.
- ~~Conductor in the game~~ — done in Zwap: sections chosen by energy, a DJ
  that plays with each section for minutes, fills, drops and stingers (see
  Zwap's `docs/MUSIC.md`).
- Chord changes: transpose tracks or swap harmony tracks at the next bar
  (pitch is baked into the upload: rebuild + hand-over).

### 4. Sequencer extension (C++ `TxSeq`, one wasm rebuild) — open
- Timed command queue on the audio thread: `{ at: row (+ offset), cmd }` for
  jump-to-data, note on/off, mute and param values. An exact `jumpAt` replaces
  the bridge / settle / target hand-over; accents become sample-accurate.
- Shared voices per instrument: note-ons from all of an instrument's tracks go
  to a pool of N voices instead of one fixed slot per track (every compiled
  voice costs CPU, sounding or not). Fits NNA in [FEATURES.md](./FEATURES.md).
- Optional: a sample-time stamp on row events for an exact clock.
- Needs emsdk 3.1.52 and `vendor/elementary` (see
  [NATIVE_SEQUENCER_NODE.md](./NATIVE_SEQUENCER_NODE.md)).

### 5. Game screen — steps 1–2 done; the screen open
1. **The conductor moves here** (done) from Zwap: section choice by energy
   (`MusicEnergy`), the DJ (`MusicDj`), plans for moods, fills and level-ups
   (`MusicConductor`) become pure modules in `src/player/`, and the stateful
   part of Zwap's `MusicService` a `GameConductor` in `src/headless/` around a
   `SongPlayer`, exported by the player package. Zwap keeps only its game
   hooks (scenes and bombs to moods, events to conductor calls, the mix).
2. **Game settings in the song** (done): `doc.game` (v18). `persist/completeGame`
   gives missing fields their defaults and drops parts naming a cue or
   instrument the song lacks; `SongPlayer.game` hands them to a game. Zwap's
   score carries them, and Zwap plays from them (its `music.ts` copy is the
   fallback for a score without them).
3. **The Game screen, simulator**: buttons for game events (a move, cascades,
   level-up, danger on / off, last move, penalty, unlock, idle), sliders for
   level and progress, and a live readout: the section, its visit (bars,
   stay, due), the parts in / out or cut, the energy and the DJ's last move.
4. **The Game screen, settings**: a section table (energy, length, what may
   follow, the DJ's parts, transition), mood cues, fills, drops, the DJ's
   part groups and timings, and stinger note sequences.

Fills fit the music they break into (done): a fill keeps the mutes and the
DJ's faded or cut parts as they were, the cascade fill skips sections below
`fill.minEnergy`, and a fill lands on more (a cut slams back, else a faded
part comes in on the downbeat). **Fills by direction** (done): `fills`, each
marked up / level / down with the energy range of the section it breaks
into. A cascade plays a `level` one, a level-up one going where the next
section goes (a build-up into a fuller one, a falling fill into a quieter
one, which doesn't land on more).

**The peak lands at the level-up** (done): from `song.peak.from` of a level's
progress the section moves on (the player's progress is the nudge) and heads
for `song.peak.cue`, the way into the chorus, once per level. A level-up lets
a transition play out and celebrates inside a peak section (a fill in place,
another pass of it), so the breath comes after the chorus, not instead of it.

Settings name cues and instruments by id or name; renaming a section, pattern
or instrument rewrites the names that meant it (`mapGameCues`,
`mapGameInstruments` from the rename ops), so a rename never drops part of
the settings on the next load.

## Composing for Zwap

> The ideas below shaped the score. What Zwap plays now — sections (calm,
> stage1, interlude, pre, chorus, break) chosen by energy and played with by a
> DJ, rather than one stage per level band — and the events still to wire up
> are in Zwap's `docs/MUSIC.md`. The track roles still hold.

### Tools

| Tool | Made as | Plays |
|---|---|---|
| **Stage** | A section (1–4 patterns), looping | Changes at the next bar or loop end |
| **Layer** | A track inside the stage patterns | Muted / unmuted on the next beat |
| **Fill** | A 1-bar pattern (16 rows) | Replaces the loop's last bar, then the stage continues |
| **Transition** | A 1–2 bar pattern | Plays once between two stages |
| **Stinger** | A few notes on an instrument | Over the music, on the next 8th / 16th |

### Track roles (the same number in every pattern)

| # | Role | # | Role |
|---|---|---|---|
| 1 | Kick | 10 | Arp / pulse |
| 2 | Snare / clap | 11 | Lead melody |
| 3 | Hats | 12 | Tension (riser, ticking, drone) |
| 4 | Percussion | 13 | Accent instrument for stingers |
| 5 | Bass | | |
| 6–9 | Chords (one note per track, up to 4) | | |

- **Drums on separate tracks**, each playing the drum's own instrument (e.g.
  Synth Kick), not one shared kit: every drum-kit track compiles *all* of the
  kit's sounds, so four tracks of one kit cost four full kits. One instrument
  per drum track is one voice, and each sound can be muted or faded alone.
- **Chords** take a track per note, i.e. a voice per note while they sound.
  Three-note voicings or a thick (detuned) pad patch keep it cheap.
- **Arp** fits one track. An instrument-level auto-arpeggiator (playing a held
  chord, with per-instrument rules for simultaneous notes) is an open idea.

### Stages

| Stage | Trigger | Idea | Length |
|---|---|---|---|
| `menu` | Menu, lobby, scores, settings | Pads + arp, no drums | 64 |
| `intro` | New game / resume, first turn | Count-in: kick and bass enter | 16–32, once |
| `stage1` | Levels 1–2 | Sparse groove: kick, bass, light hats | 64, A/B |
| `stage2` | Levels 3–5 | + snare, pads, arp | 64, A/B |
| `stage3` | Levels 6–9 | Full kit, lead | 64, A/B |
| `stage4` | Level 10+ | Peak: double-time hats, driving bass | 64, A/B |
| `danger` | A bomb at ≤ 3 moves (`updateBombs`) | Same key, darker chords, tension on | 32 |
| `lastMove` | A bomb at 1 move | Drums out, ticking + drone only | 16 |
| `gameover` | Explosion → `GameOver` | Outro hit, then a calm loop | 16 + 64 |
| `highscore` | Game over with a new record | Major-key `gameover` | 64 |

A/B variants alternate every 2 loops.

### Layers (from the board, checked after every turn)

| Layer | Game state | On |
|---|---|---|
| Tension (12) | `movesWithoutReaction` hits the warning (`doNoReactionPenalty`) | Drone / pulse |
| Ticking (3) | A bomb at 3, then 2 moves | 16th, then 32nd hats |
| Lead (11) | Level progress ≥ 50% | Melody |
| Riser (12) | `shouldLevelUp` / ≥ 90% progress | Snare roll / riser |
| Thin-out | No move for 15 s | Pads + bass only until the next move |

### Stingers and fills from player actions

| Event | Hook | Idea |
|---|---|---|
| Set matched | `doMatch` | Chord stab; 5+ blocks → fuller voicing |
| Cascade step | `doReaction(count)` | Climbing arpeggio: root, 3rd, 5th, octave, … |
| Cascade ≥ 3 | end of `doChainReactions` | `fill-cascade` at the next bar end |
| Big turn score | `achievements.max("maxTurnScore")` | `fill-hype` with a crash |
| Move without reaction | `doNoReactionPenalty`, first miss | A dull, muted note |
| Penalty | `applyPenalty` (score / bomb / lock) | Dissonant stab, drums out for 1 bar |
| Lock opened | `unlockLocks` | A chime per lock |
| Wireless key | `doWirelessRemoveLocks` | Glissando across the unlocked locks |
| Keys collected | `doCollectKeys` | Chime run on the 300 ms key flights |
| Bomb appears | backlog drop (`changeBlockShape`) | Low boom, tension layer on |
| Bomb defused / detonated | `controlledBombBlast` | Big hit, 1-bar break, `fill-relief` |
| Special about to drop | `turnsUntilNextSpecial === 1` | 1-bar riser |
| Achievement | `achievements.onUnlock` | Short fanfare in key |

### Transitions

| Name | When |
|---|---|
| `to-stage2` / `to-stage3` / `to-stage4` | Level-up into the next band, as long as `showLevelUp` |
| `to-danger` / `from-danger` | Into / out of danger (`from-danger` is relief) |
| `to-gameover` | Explosion: collapse, silence on the downbeat |
| `menu-to-game` | New Game tap: 1-bar pickup into `intro` |

### Modes

| Mode | Extras |
|---|---|
| Versus (4-minute match, `VersusRules`) | `versus` stage; `finalMinute` at 60 s left; `countdown` at 10 s; stingers for attack sent (`sendAttacks`), incoming (`queueIncoming`, 2 turns ahead) and landing; `win` / `lose` / `draw` outros |
| Daily challenge | Its own song or variant (same for everyone that day); "beat yesterday's score" stinger |
| Challenge (a friend's board) | Reuses the stages; stinger when passing the friend's score |

### Minimum first set

`menu`, `intro`, `stage1` A + B, `stage2` A, `danger`, `lastMove`,
`fill-cascade`, `to-stage2`, `gameover` — plus stingers on track 13 (match,
cascade arpeggio, penalty) and layer tracks 11 (lead) and 12 (tension).
