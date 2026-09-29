import type { SelectHTMLAttributes } from 'react'
import { cx } from './cx'
import s from './Select.module.css'

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  small?: boolean
  /** Fills the container's width. */
  block?: boolean
}

export function Select({ small, block, className, ...rest }: SelectProps) {
  return <select className={cx(s.select, small && s.small, block && s.block, className)} {...rest} />
}
