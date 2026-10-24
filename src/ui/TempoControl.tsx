import { memo, useRef, useState } from 'react'
import { useDocStore } from '../state/docStore'
import { MAX_BPM, MIN_BPM } from '../domain/types'
import { EditableLabel } from './components/EditableLabel'
import { cx } from './components/cx'
import { tapTempo } from './tapTempo'
import s from './TempoControl.module.css'

/** Song tempo (saved with the song): double-click the BPM to type one, or tap it in. */
export const TempoControl = memo(function TempoControl() {
  const bpm = useDocStore((st) => st.doc.tempo.bpm)
  const setBpm = useDocStore((st) => st.setBpm)
  const tapsRef = useRef<number[]>([])
  const [flash, setFlash] = useState(false)

  const commit = (text: string) => {
    const n = Number(text)
    if (text.trim() && n >= MIN_BPM && n <= MAX_BPM) setBpm(n)
  }

  const tap = () => {
    const next = tapTempo(tapsRef.current, performance.now())
    tapsRef.current = next.times
    if (next.bpm !== null) setBpm(next.bpm)
    setFlash(true)
    setTimeout(() => setFlash(false), 150)
  }

  return (
    <span className={s.group}>
      <EditableLabel value={String(bpm)} onCommit={commit} commitOnBlur
        className={s.bpm} inputClassName={s.bpmInput} title="Double-click to edit tempo" />
      <span className={s.unit}>BPM</span>
      <button type="button" className={cx(s.tap, flash && s.flash)} title="Tap tempo" onClick={tap}>TAP</button>
    </span>
  )
})
