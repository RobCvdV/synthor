import { cx } from '../components/cx'
import { amplitudeY, type Lane } from './waveView'
import s from './AmplitudeAxis.module.css'

const LEVELS = [1, 0.5, 0, -0.5, -1]

/**
 * Normalized amplitude scale beside the waveform lanes: 1.0 at full scale, 0 at the center,
 * so a stretched view still shows how loud the sample really is.
 */
export function AmplitudeAxis({ lanes }: { lanes: Lane[] }) {
  return (
    <div className={s.axis} aria-hidden>
      {lanes.flatMap((lane, i) =>
        // A lower lane's top label already marks the gap, so the upper lane skips its bottom one.
        LEVELS.filter((v) => v !== -1 || i === lanes.length - 1).map((v) => (
          <span key={`${i}:${v}`} className={cx(s.tick, v === 0 && s.zero)} style={{ top: amplitudeY(lane, v) }}>
            {Math.abs(v) === 0 ? '0' : Math.abs(v).toFixed(1)}
          </span>
        )))}
    </div>
  )
}
