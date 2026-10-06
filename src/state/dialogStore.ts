import { create } from 'zustand'

export interface ConfirmRequest {
  kind: 'confirm'
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

export interface TextRequest {
  kind: 'text'
  message: string
  defaultValue: string
  confirmLabel?: string
  /** Returns an error to show, or null when the value is acceptable. */
  validate?: (value: string) => string | null
}

export interface RangeRequest {
  kind: 'range'
  message: string
  /** Prefilled hex values; empty when the cell has none. */
  start: string
  end: string
  confirmLabel?: string
}

export interface RangeAnswer { start: number; end: number }

type Request = ConfirmRequest | TextRequest | RangeRequest
type Answer = boolean | string | RangeAnswer | null

interface DialogState {
  request: Request | null
  resolve: ((answer: Answer) => void) | null
  answer: (answer: Answer) => void
}

/** The one pending app dialog; `DialogHost` renders it. */
export const useDialogStore = create<DialogState>((set, get) => ({
  request: null,
  resolve: null,
  answer: (answer) => {
    get().resolve?.(answer)
    set({ request: null, resolve: null })
  },
}))

function ask(request: Request): Promise<Answer> {
  useDialogStore.getState().resolve?.(null)
  return new Promise((resolve) => useDialogStore.setState({ request, resolve }))
}

/** Async replacement for `window.confirm`; a newer dialog cancels a pending one. */
export function askConfirm(request: Omit<ConfirmRequest, 'kind'>): Promise<boolean> {
  return ask({ kind: 'confirm', ...request }).then((a) => a === true)
}

/** Async replacement for `window.prompt`; resolves null when cancelled. */
export function askText(request: Omit<TextRequest, 'kind'>): Promise<string | null> {
  return ask({ kind: 'text', ...request }).then((a) => (typeof a === 'string' ? a : null))
}

/** Asks for a start and end value (hex 00–FF, as 0..1); resolves null when cancelled. */
export function askRange(request: Omit<RangeRequest, 'kind'>): Promise<RangeAnswer | null> {
  return ask({ kind: 'range', ...request }).then((a) => (a !== null && typeof a === 'object' ? a : null))
}
