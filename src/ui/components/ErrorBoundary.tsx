import { Component, type ReactNode } from 'react'
import { Button } from './Button'
import s from './ErrorBoundary.module.css'

interface Props {
  /** Changing it clears the error, e.g. the current view. */
  resetKey: unknown
  children: ReactNode
}

interface State {
  error: Error | null
  resetKey: unknown
}

/** Shows a failing part of the app as an error with a retry, instead of blanking the whole window. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, resetKey: this.props.resetKey }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.resetKey ? { error: null, resetKey: props.resetKey } : null
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className={s.panel} role="alert">
        <strong>Something went wrong here.</strong>
        <code className={s.message}>{error.message}</code>
        <span className="muted">Your song is safe. Try again, or switch to another view.</span>
        <Button onClick={() => this.setState({ error: null })}>Try Again</Button>
      </div>
    )
  }
}
