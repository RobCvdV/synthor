/**
 * Public API of the headless player (`npm run build:player`): synthor songs in
 * a game or any page, without the editor.
 */

export { SongPlayer, type SongPlayerOptions, type CueTiming, type CueStep, type NoteTiming, type RowEvent, type MusicPosition } from './SongPlayer'
export type { Cue, CueInfo } from '../player/cues'
export { unpackSongBundle, type SongBundle } from '../persist/songBundle'
export type { SongFile, SongMeta } from '../persist/serialize'
export {
  GameConductor, type ConductedPlayer, type ConductorSnapshot, type GameConductorOptions,
} from './GameConductor'
export {
  PLAY_MOOD, type GameMusic, type GameSection, type GameMood, type GameStinger, type GameFill, type DjRules,
} from '../domain/gameMusic'
export type { DjMove, DjVisit } from '../player/game/dj'
export type { Energy } from '../player/game/energy'
