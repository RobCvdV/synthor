import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => cleanup())

// Stubs for APIs jsdom lacks; guarded so node-env tests are unaffected.
if (!globalThis.ResizeObserver) {
  ;(globalThis as Record<string, unknown>).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}
if (!globalThis.DOMMatrixReadOnly) {
  ;(globalThis as Record<string, unknown>).DOMMatrixReadOnly = class {}
}