import type { ReactNode } from 'react'
import { PLAY_MOOD, type GameFill, type GameMusic, type GameStinger } from '../../domain/gameMusic'
import {
  cueNames, freeName, instrumentNames, removeGroup, removeSection, renameGroup, renameKey, retargetSection,
} from '../../domain/gameEdit'
import { useDocStore } from '../../state/docStore'
import { askConfirm } from '../../state/dialogStore'
import { Button } from '../components/Button'
import { NameInput } from '../components/NameInput'
import { CheckField, ChoiceField, Chips, NotesField, NumberField, RemoveButton, TextField, TracksField } from './fields'
import s from './GameView.module.css'

type Edit = (recipe: (game: GameMusic) => void) => void

const edit: Edit = (recipe) => useDocStore.getState().editGame(recipe)
const toggle = (list: string[] | undefined, name: string) =>
  (list ?? []).includes(name) ? (list ?? []).filter((n) => n !== name) : [...(list ?? []), name]
/** The stingers the conductor plays by these names */
const CONDUCTED = { cascade: 'a note per reaction', keys: 'a note per key', levelUp: 'on a level-up' } as Record<string, string>
const GOES: GameFill['goes'][] = ['up', 'level', 'down']
const AT: GameStinger['at'][] = ['row', 'beat', 'bar']

function Block({ title, hint, children, add }: { title: string; hint?: string; children: ReactNode; add?: () => void }) {
  return (
    <section className={s.block}>
      <h3 className={s.heading}>
        {title}
        {add && <Button size="xs" onClick={add}>+ add</Button>}
      </h3>
      {hint && <p className={s.hint}>{hint}</p>}
      {children}
    </section>
  )
}

function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <table className={s.grid}>
      <thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
      <tbody>{children}</tbody>
    </table>
  )
}

function SongBlock({ game, cues }: { game: GameMusic; cues: string[] }) {
  const sectionCues = game.song.sections.map((x) => x.cue)
  return (
    <Block title="Song" hint="Where play starts, the way into it, and where the end of a level heads.">
      <div className={s.row}>
        <span className={s.label}>Starts at</span>
        <ChoiceField title="First section" value={game.song.start} choices={sectionCues} onChange={(v) => edit((g) => { g.song.start = v ?? '' })} />
        <span className={s.label}>Intro</span>
        <ChoiceField title="Intro" value={game.intro} choices={cues} none="none" onChange={(v) => edit((g) => { if (v) g.intro = v; else delete g.intro })} />
        <span className={s.label}>Rows per bar</span>
        <NumberField title="Rows per bar" value={game.bar} min={1} int onCommit={(v) => edit((g) => { g.bar = v! })} />
      </div>
      <div className={s.row}>
        <span className={s.label}>Peak via</span>
        <ChoiceField
          title="Section the end of a level heads for"
          value={game.song.peak?.cue}
          choices={sectionCues}
          none="none"
          onChange={(v) => edit((g) => { if (v) g.song.peak = { from: g.song.peak?.from ?? 0.85, cue: v }; else delete g.song.peak })}
        />
        {game.song.peak && (
          <>
            <span className={s.label}>from</span>
            <NumberField title="Level progress (%)" value={Math.round(game.song.peak.from * 100)} min={0} max={100} int
              onCommit={(v) => edit((g) => { if (g.song.peak) g.song.peak.from = v! / 100 })} />
            <span className={s.label}>% of a level</span>
          </>
        )}
      </div>
    </Block>
  )
}

function SectionsBlock({ game, cues }: { game: GameMusic; cues: string[] }) {
  const sectionCues = game.song.sections.map((x) => x.cue)
  const parts = Object.keys(game.dj.groups)
  const free = cues.find((c) => !sectionCues.includes(c))
  return (
    <Block
      title="Sections"
      hint="What the game moves between. Energy 1 (sparse) to 5 (everything); a visit lasts a few times its bars. Next: what may follow (any when none)."
      add={free === undefined ? undefined : () => edit((g) => { g.song.sections.push({ cue: free, energy: 3, bars: 4 }) })}
    >
      <Table head={['Cue', 'Energy', 'Bars', 'Transition', 'DJ parts', 'Next', 'Via', 'Muted', '']}>
        {game.song.sections.map((sec, i) => (
          <tr key={sec.cue}>
            <td>
              <ChoiceField title="Cue" value={sec.cue} choices={cues.filter((c) => c === sec.cue || !sectionCues.includes(c))}
                onChange={(v) => v && edit((g) => retargetSection(g, sec.cue, v))} />
            </td>
            <td><NumberField title="Energy" value={sec.energy} min={1} max={5} onCommit={(v) => edit((g) => { g.song.sections[i].energy = v! })} /></td>
            <td><NumberField title="Bars" value={sec.bars} min={1} int onCommit={(v) => edit((g) => { g.song.sections[i].bars = v! })} /></td>
            <td>
              <CheckField title="Plays once and moves straight on" value={!!sec.transition}
                onChange={(v) => edit((g) => { if (v) g.song.sections[i].transition = true; else delete g.song.sections[i].transition })} />
            </td>
            <td><Chips title="Parts the DJ plays with" options={parts} selected={sec.toys ?? []} onToggle={(p) => edit((g) => { g.song.sections[i].toys = toggle(g.song.sections[i].toys, p) })} /></td>
            <td><Chips title="Sections that may follow" options={sectionCues.filter((c) => c !== sec.cue)} selected={sec.next ?? []} onToggle={(c) => edit((g) => { g.song.sections[i].next = toggle(g.song.sections[i].next, c) })} /></td>
            <td>
              <ChoiceField title="Played once on the way in" value={sec.via} choices={cues} none="—"
                onChange={(v) => edit((g) => { if (v) g.song.sections[i].via = v; else delete g.song.sections[i].via })} />
            </td>
            <td><TracksField title="Muted track #s" value={sec.muted ?? []} onCommit={(t) => edit((g) => { if (t.length) g.song.sections[i].muted = t; else delete g.song.sections[i].muted })} /></td>
            <td><RemoveButton title={`Remove ${sec.cue}`} onClick={() => edit((g) => removeSection(g, sec.cue))} /></td>
          </tr>
        ))}
      </Table>
    </Block>
  )
}

function MoodsBlock({ game, cues }: { game: GameMusic; cues: string[] }) {
  return (
    <Block
      title="Moods"
      hint="Music for the game's moods (play is the sections). Returns: play carries on where it would have been afterwards. Hit: played at once, then the cue."
      add={cues.length ? () => edit((g) => { g.moods[freeName([...Object.keys(g.moods), PLAY_MOOD], 'mood')] = { cue: cues[0] } }) : undefined}
    >
      <Table head={['Name', 'Cue', 'Hit', 'Returns', 'Muted', '']}>
        {Object.entries(game.moods).map(([name, mood]) => (
          <tr key={name}>
            <td><NameInput className={s.field} aria-label="Mood name" value={name} onCommit={(to) => to !== PLAY_MOOD && edit((g) => { g.moods = renameKey(g.moods, name, to) })} /></td>
            <td><ChoiceField title="Cue" value={mood.cue} choices={cues} onChange={(v) => v && edit((g) => { g.moods[name].cue = v })} /></td>
            <td><ChoiceField title="Hit" value={mood.hit} choices={cues} none="—" onChange={(v) => edit((g) => { if (v) g.moods[name].hit = v; else delete g.moods[name].hit })} /></td>
            <td><CheckField title="Play carries on after it" value={!!mood.returns} onChange={(v) => edit((g) => { if (v) g.moods[name].returns = true; else delete g.moods[name].returns })} /></td>
            <td><TracksField title="Muted track #s" value={mood.muted ?? []} onCommit={(t) => edit((g) => { if (t.length) g.moods[name].muted = t; else delete g.moods[name].muted })} /></td>
            <td><RemoveButton title={`Remove ${name}`} onClick={() => edit((g) => { delete g.moods[name] })} /></td>
          </tr>
        ))}
      </Table>
    </Block>
  )
}

function FillsBlock({ game, cues }: { game: GameMusic; cues: string[] }) {
  const { fill } = game
  return (
    <Block
      title="Fills"
      hint="Picked by where the music goes and the energy of the section they break into: a cascade plays a level one, a level-up one going up or down. The cascade fill and the level-up fill play when none fits."
      add={cues.length ? () => edit((g) => { (g.fills ??= []).push({ cue: cues[0], goes: 'level' }) }) : undefined}
    >
      <div className={s.row}>
        <span className={s.label}>Cascade fill</span>
        <ChoiceField title="Cascade fill" value={fill?.cue} choices={cues} none="none"
          onChange={(v) => edit((g) => { if (v) g.fill = { minCascade: 3, ...g.fill, cue: v }; else delete g.fill })} />
        {fill && (
          <>
            <span className={s.label}>at reaction</span>
            <NumberField title="Reaction that plays it" value={fill.minCascade} min={1} int onCommit={(v) => edit((g) => { g.fill!.minCascade = v! })} />
            <span className={s.label}>bars apart</span>
            <NumberField title="At least this many bars apart" value={fill.minBarsApart} min={0} int optional
              onCommit={(v) => edit((g) => { if (v === undefined) delete g.fill!.minBarsApart; else g.fill!.minBarsApart = v })} />
            <span className={s.label}>min energy</span>
            <NumberField title="Not in a section below this energy" value={fill.minEnergy} min={1} max={5} optional
              onCommit={(v) => edit((g) => { if (v === undefined) delete g.fill!.minEnergy; else g.fill!.minEnergy = v })} />
          </>
        )}
      </div>
      <div className={s.row}>
        <span className={s.label}>Level-up fill</span>
        <ChoiceField title="Level-up fill" value={game.levelUp?.cue} choices={cues} none="none"
          onChange={(v) => edit((g) => { if (v) g.levelUp = { cue: v }; else delete g.levelUp })} />
      </div>
      {(game.fills?.length ?? 0) > 0 && (
        <Table head={['Cue', 'Goes', 'Min energy', 'Max energy', '']}>
          {game.fills!.map((f, i) => (
            <tr key={i}>
              <td><ChoiceField title="Cue" value={f.cue} choices={cues} onChange={(v) => v && edit((g) => { g.fills![i].cue = v })} /></td>
              <td><ChoiceField title="Goes" value={f.goes} choices={GOES} onChange={(v) => v && edit((g) => { g.fills![i].goes = v as GameFill['goes'] })} /></td>
              <td><NumberField title="Min energy" value={f.minEnergy} min={1} max={5} optional onCommit={(v) => edit((g) => { if (v === undefined) delete g.fills![i].minEnergy; else g.fills![i].minEnergy = v })} /></td>
              <td><NumberField title="Max energy" value={f.maxEnergy} min={1} max={5} optional onCommit={(v) => edit((g) => { if (v === undefined) delete g.fills![i].maxEnergy; else g.fills![i].maxEnergy = v })} /></td>
              <td><RemoveButton title={`Remove ${f.cue}`} onClick={() => edit((g) => { g.fills!.splice(i, 1) })} /></td>
            </tr>
          ))}
        </Table>
      )}
    </Block>
  )
}

function DjBlock({ game }: { game: GameMusic }) {
  const { dj } = game
  return (
    <Block
      title="DJ"
      hint="Parts the DJ fades in and out, swaps and cuts, by their track #s. One move per phrase; a visit lasts its section's bars times one of the stays."
      add={() => edit((g) => { g.dj.groups[freeName(Object.keys(g.dj.groups), 'part')] = [] })}
    >
      <div className={s.row}>
        <span className={s.label}>Phrase bars</span>
        <NumberField title="Bars per phrase" value={dj.phraseBars} min={1} int onCommit={(v) => edit((g) => { g.dj.phraseBars = v! })} />
        <span className={s.label}>Fade bars</span>
        <NumberField title="Bars a fade takes" value={dj.fadeBars} min={0} onCommit={(v) => edit((g) => { g.dj.fadeBars = v! })} />
        <span className={s.label}>Stays</span>
        <TextField title="Visit lengths, in section lengths" value={dj.stays.join(' ')} width={100}
          onCommit={(text) => {
            const stays = text.split(/[\s,]+/).map(Number).filter((n) => Number.isFinite(n) && n > 0)
            if (!stays.length) return false
            edit((g) => { g.dj.stays = stays })
          }} />
      </div>
      <Table head={['Part', 'Tracks', '']}>
        {Object.entries(dj.groups).map(([name, tracks]) => (
          <tr key={name}>
            <td><NameInput className={s.field} aria-label="Part name" value={name} onCommit={(to) => edit((g) => renameGroup(g, name, to))} /></td>
            <td><TracksField title="Track #s" value={tracks} onCommit={(t) => edit((g) => { g.dj.groups[name] = t })} /></td>
            <td><RemoveButton title={`Remove ${name}`} onClick={() => edit((g) => removeGroup(g, name))} /></td>
          </tr>
        ))}
      </Table>
    </Block>
  )
}

function DropsBlock({ game }: { game: GameMusic }) {
  const { stops } = game
  return (
    <Block
      title="Drops and stops"
      hint="Drops: tracks a game cuts until the next bar, by name (a penalty…). Stops: now and then a phrase's last beat without these tracks."
      add={() => edit((g) => { g.drops[freeName(Object.keys(g.drops), 'drop')] = [] })}
    >
      <Table head={['Drop', 'Tracks', '']}>
        {Object.entries(game.drops).map(([name, tracks]) => (
          <tr key={name}>
            <td><NameInput className={s.field} aria-label="Drop name" value={name} onCommit={(to) => edit((g) => { g.drops = renameKey(g.drops, name, to) })} /></td>
            <td><TracksField title="Track #s" value={tracks} onCommit={(t) => edit((g) => { g.drops[name] = t })} /></td>
            <td><RemoveButton title={`Remove ${name}`} onClick={() => edit((g) => { delete g.drops[name] })} /></td>
          </tr>
        ))}
      </Table>
      <div className={s.row}>
        <CheckField title="Stops" value={!!stops}
          onChange={(v) => edit((g) => { if (v) g.stops = { tracks: [1, 2], everyBars: 4, chance: 0.2, minEnergy: 2 }; else delete g.stops })}>
          Stops
        </CheckField>
        {stops && (
          <>
            <TracksField title="Tracks that stop" value={stops.tracks} onCommit={(t) => edit((g) => { g.stops!.tracks = t })} />
            <span className={s.label}>every</span>
            <NumberField title="Every this many bars" value={stops.everyBars} min={1} int onCommit={(v) => edit((g) => { g.stops!.everyBars = v! })} />
            <span className={s.label}>bars, chance</span>
            <NumberField title="Chance (0–1)" value={stops.chance} min={0} max={1} onCommit={(v) => edit((g) => { g.stops!.chance = v! })} />
            <span className={s.label}>min energy</span>
            <NumberField title="Min energy" value={stops.minEnergy} min={0} max={5} onCommit={(v) => edit((g) => { g.stops!.minEnergy = v! })} />
          </>
        )}
      </div>
    </Block>
  )
}

function StingersBlock({ game, instruments }: { game: GameMusic; instruments: string[] }) {
  return (
    <Block
      title="Stingers"
      hint="Notes over the music. The conductor plays cascade (a climbing note per reaction), keys and levelUp itself; a game plays the others by name."
      add={instruments.length ? () => edit((g) => { g.stingers[freeName(Object.keys(g.stingers), 'stinger')] = { instrument: instruments[0], notes: [69], at: 'beat', rows: 2 } }) : undefined}
    >
      <Table head={['Name', 'Instrument', 'Notes', 'At', 'Rows', 'Velocity', '']}>
        {Object.entries(game.stingers).map(([name, st]) => (
          <tr key={name}>
            <td>
              <NameInput className={s.field} aria-label="Stinger name" value={name} onCommit={(to) => edit((g) => { g.stingers = renameKey(g.stingers, name, to) })} />
              {CONDUCTED[name] && <span className={s.label}> {CONDUCTED[name]}</span>}
            </td>
            <td><ChoiceField title="Instrument" value={st.instrument} choices={instruments} onChange={(v) => v && edit((g) => { g.stingers[name].instrument = v })} /></td>
            <td><NotesField title="Notes (A-4 C-5 … or MIDI numbers)" value={st.notes} onCommit={(n) => edit((g) => { g.stingers[name].notes = n })} /></td>
            <td><ChoiceField title="Lands on the next" value={st.at} choices={AT} onChange={(v) => v && edit((g) => { g.stingers[name].at = v as GameStinger['at'] })} /></td>
            <td><NumberField title="Rows each note is held" value={st.rows} min={1} int onCommit={(v) => edit((g) => { g.stingers[name].rows = v! })} /></td>
            <td>
              <NumberField title="Velocity (0–127)" value={st.velocity} min={0} max={127} int optional
                onCommit={(v) => edit((g) => { if (v === undefined) delete g.stingers[name].velocity; else g.stingers[name].velocity = v })} />
            </td>
            <td><RemoveButton title={`Remove ${name}`} onClick={() => edit((g) => { delete g.stingers[name] })} /></td>
          </tr>
        ))}
      </Table>
    </Block>
  )
}

/** The song's game settings, every part editable; each change is one undo step */
export function GameSettings({ game }: { game: GameMusic }) {
  const doc = useDocStore((st) => st.doc)
  const cues = cueNames(doc)
  const instruments = instrumentNames(doc)
  const remove = async () => {
    const message = 'Remove this song’s game settings? A game playing it then has only its own.'
    if (await askConfirm({ message, confirmLabel: 'Remove', danger: true })) useDocStore.getState().removeGame()
  }
  return (
    <div className={s.settings}>
      <p className={s.hint}>Changes are saved with the song; restart the simulator to hear them.</p>
      <SongBlock game={game} cues={cues} />
      <SectionsBlock game={game} cues={cues} />
      <MoodsBlock game={game} cues={cues} />
      <FillsBlock game={game} cues={cues} />
      <DjBlock game={game} />
      <DropsBlock game={game} />
      <StingersBlock game={game} instruments={instruments} />
      <div className={s.row}>
        <Button size="sm" tone="danger" onClick={() => void remove()}>Remove game settings</Button>
      </div>
    </div>
  )
}
