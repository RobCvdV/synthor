import { describe, expect, it } from 'vitest'
import { compileGraph } from './compile'
import { createDefaultDoc } from '../domain/factory'
import type { Doc } from '../domain/types'

describe('compileGraph', () => {
  it('builds a graph node from the default document without throwing', () => {
    const doc = createDefaultDoc()
    const node = compileGraph(doc, { rowHz: 8, playing: 1 })
    expect(node).toBeTruthy()
  })

  it('handles an empty pattern (no tracks) by returning silence', () => {
    const doc = createDefaultDoc()
    const empty: Doc = {
      ...doc,
      entities: {
        ...doc.entities,
        patterns: {
          [doc.patternId]: { ...doc.entities.patterns[doc.patternId], trackIds: [] },
        },
      },
    }
    expect(() => compileGraph(empty, { rowHz: 8, playing: 0 })).not.toThrow()
  })
})
