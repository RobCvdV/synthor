import { cx } from './cx'
import s from './BypassToggle.module.css'

/** Power-icon toggle for an effect's bypass state. */
export function BypassToggle({ bypassed, onToggle, className }: {
  bypassed: boolean
  onToggle: (bypassed: boolean) => void
  className?: string
}) {
  return (
    <button type="button" className={cx(s.toggle, bypassed && s.off, className)}
      title={bypassed ? 'Bypassed — click to engage' : 'Active — click to bypass'}
      onClick={(e) => { e.preventDefault(); onToggle(!bypassed) }}>
      ⏻
    </button>
  )
}
