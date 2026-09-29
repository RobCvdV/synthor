import type { ButtonHTMLAttributes } from 'react'
import { cx } from './cx'
import s from './Button.module.css'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: 'md' | 'sm' | 'xs'
  /** Highlights the button in its `tone` color. */
  active?: boolean
  tone?: 'accent' | 'danger' | 'warn'
}

export function Button({ size = 'md', active, tone = 'accent', className, type = 'button', ...rest }: ButtonProps) {
  return <button type={type} className={cx(s.button, s[size], active && s[tone], className)} {...rest} />
}
