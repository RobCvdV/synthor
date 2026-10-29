import type { GameMusic } from '../domain/gameMusic'
import { starterGame } from '../domain/gameEdit'
import type { DocState } from './docStore'

export interface GameOps {
  /** Give the song game settings to start from (its sections). One undoable edit. */
  createGame: () => void
  removeGame: () => void
  /** Change the song's game settings, as one undoable edit; nothing without settings */
  editGame: (recipe: (game: GameMusic) => void) => void
}

export function gameOps(get: () => DocState): GameOps {
  return {
    createGame: () =>
      get().mutate((draft) => {
        draft.game ??= starterGame(draft)
      }),
    removeGame: () =>
      get().mutate((draft) => {
        delete draft.game
      }),
    editGame: (recipe) =>
      get().mutate((draft) => {
        if (draft.game) recipe(draft.game)
      }),
  }
}
