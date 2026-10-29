import { useEffect, useState } from 'react'
import { useDocStore } from '../../state/docStore'
import { useProjectStore } from '../../state/projectStore'
import { useTransportStore } from '../../state/transportStore'
import { currentSongFile } from '../../persist/saveCurrent'
import { exportSongZip } from '../../persist/songExport'
import type { ConductorSnapshot } from '../../headless/GameConductor'
import { Button } from '../components/Button'
import { ParamSlider } from '../components/ParamSlider'
import { cx } from '../components/cx'
import { gameSimulator, type GameSimulator } from './GameSimulator'
import { gameButtons, partRows, readoutRows } from './gameReadout'
import s from './GameView.module.css'

const POLL_MS = 250
const CASCADES = [2, 3, 5]
const MAX_LEVEL = 20

/** The open song with its samples, as a game would load it */
async function songBytes(): Promise<ArrayBuffer> {
  const blob = await exportSongZip(currentSongFile(), useProjectStore.getState().slug)
  return blob.arrayBuffer()
}

/**
 * The Game screen: plays the open song the way a game conducts it, with
 * buttons for the game's events and a readout of what the conductor and its
 * DJ do, to tune a song's game music by ear.
 */
export function GameView({ simulator = gameSimulator() }: { simulator?: GameSimulator }) {
  const game = useDocStore((st) => st.doc.game)
  const [snap, setSnap] = useState<ConductorSnapshot | null>(simulator.snapshot())
  const [log, setLog] = useState<string[]>(simulator.log)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)

  useEffect(() => {
    simulator.preload()
    const id = setInterval(() => {
      setSnap(simulator.snapshot())
      setLog(simulator.log)
    }, POLL_MS)
    // leaving the screen stops the music
    return () => {
      clearInterval(id)
      simulator.stop()
    }
  }, [simulator])

  if (!game) {
    return (
      <div className={s.view}>
        <p className={s.empty}>
          This song has no game settings. A game conducts a song from them: its sections by energy,
          the parts a DJ plays with, moods, fills and stingers.
        </p>
      </div>
    )
  }

  const music = simulator.music ?? game
  const buttons = gameButtons(music)
  const running = snap !== null
  const level = snap?.level ?? 1
  const progress = snap?.progress ?? 0

  const start = () => {
    useTransportStore.getState().stop()
    setError(null)
    setStarting(true)
    simulator.start(songBytes())
      .catch((err: Error) => setError(err.message))
      .finally(() => setStarting(false))
  }

  return (
    <div className={s.view}>
      <section className={s.controls}>
        <div className={s.row}>
          <Button onClick={start} disabled={starting} active={running}>
            {starting ? 'Starting…' : running ? 'Restart' : 'Start'}
          </Button>
          <Button onClick={() => simulator.stop()} disabled={!running}>Stop</Button>
          {error && <span className={s.error}>{error}</span>}
        </div>

        <h3 className={s.heading}>Mood</h3>
        <div className={s.row}>
          {buttons.moods.map((mood) => (
            <Button key={mood} size="sm" active={snap?.mood === mood} disabled={!running} onClick={() => simulator.setMood(mood)}>
              {mood}
            </Button>
          ))}
        </div>

        <h3 className={s.heading}>Play</h3>
        <div className={s.row}>
          {CASCADES.map((n) => (
            <Button key={n} size="sm" disabled={!running} onClick={() => simulator.cascade(n)}>Cascade {n}</Button>
          ))}
          <Button size="sm" disabled={!running} onClick={() => simulator.levelUp()}>Level up</Button>
          {music.stingers.keys && <Button size="sm" disabled={!running} onClick={() => simulator.keys(3)}>Keys</Button>}
          <Button size="sm" disabled={!running} onClick={() => simulator.nudge()} title="The player did something: a section past its time moves on">
            Nudge
          </Button>
        </div>
        {(buttons.stingers.length > 0 || buttons.drops.length > 0) && (
          <div className={s.row}>
            {buttons.stingers.map((name) => (
              <Button key={name} size="sm" disabled={!running} onClick={() => simulator.stinger(name)}>{name}</Button>
            ))}
            {buttons.drops.map((name) => (
              <Button key={name} size="sm" tone="warn" disabled={!running} onClick={() => simulator.drop(name)}>{name}</Button>
            ))}
          </div>
        )}

        <h3 className={s.heading}>Level</h3>
        <label className={s.slider}>
          <span>Level {level}</span>
          <ParamSlider
            value={level} min={1} max={MAX_LEVEL} step={1} disabled={!running}
            onChange={(v) => simulator.setProgress(Math.round(v), progress)}
          />
        </label>
        <label className={s.slider}>
          <span>Progress {Math.round(progress * 100)}%</span>
          <ParamSlider
            value={progress} min={0} max={1} step={0.01} disabled={!running}
            onChange={(v) => simulator.setProgress(level, v)}
          />
        </label>
      </section>

      <section className={s.readout}>
        {snap ? (
          <>
            <table className={s.table}>
              <tbody>
                {readoutRows(snap).map((row) => (
                  <tr key={row.label}><th>{row.label}</th><td>{row.value}</td></tr>
                ))}
              </tbody>
            </table>
            <h3 className={s.heading}>Parts</h3>
            <div className={s.row}>
              {partRows(snap, music).map((p) => (
                <span key={p.part} className={cx(s.part, s[p.state])} title={`Tracks ${p.tracks.join(', ')}`}>
                  {p.part} {p.state === 'in' ? '' : `(${p.state})`}
                </span>
              ))}
            </div>
            <h3 className={s.heading}>Log</h3>
            <pre className={s.log}>{log.slice().reverse().join('\n')}</pre>
          </>
        ) : (
          <p className={s.empty}>Start to hear the song as the game plays it.</p>
        )}
      </section>
    </div>
  )
}
