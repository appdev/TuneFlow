import { toOldMusicInfo } from '../../common/utils/tools'

export const toSourceMusicInfo = (value: unknown): unknown => {
  if (typeof value !== 'object' || value == null || !('meta' in value)) return value
  const meta = value.meta
  if (typeof meta !== 'object' || meta == null || !('songId' in meta)) return value
  return toOldMusicInfo(value as TuneFlow.Music.MusicInfo)
}

export const toSourceMusicUrlInfo = (value: unknown, quality: TuneFlow.Quality): { type: TuneFlow.Quality, musicInfo: unknown } => {
  const info = typeof value === 'object' && value != null ? value as Record<string, unknown> : {}
  return {
    type: typeof info.type === 'string' ? info.type as TuneFlow.Quality : quality,
    musicInfo: toSourceMusicInfo('musicInfo' in info ? info.musicInfo : value),
  }
}
