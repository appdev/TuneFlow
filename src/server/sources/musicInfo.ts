import { toOldMusicInfo } from '../../common/utils/tools'

const normalizeHttpUrl = (value: unknown): string | undefined => {
  if (typeof value !== 'string' || value.trim() === '') return undefined
  try {
    const url = new URL(value.trim())
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined
  } catch {
    return undefined
  }
}

export const canonicalPictureUrl = (value: unknown): string | undefined => {
  if (typeof value !== 'object' || value == null) return undefined
  const record = value as Record<string, unknown>
  const meta = typeof record.meta === 'object' && record.meta != null
    ? record.meta as Record<string, unknown>
    : {}
  return normalizeHttpUrl(meta.picUrl) ?? normalizeHttpUrl(record.img) ?? normalizeHttpUrl(record.pic)
}

export const normalizeMusicInfo = (value: unknown): TuneFlow.Music.MusicInfoOnline | unknown => {
  if (typeof value !== 'object' || value == null) return value
  const record = value as Record<string, unknown>
  const existingMeta = typeof record.meta === 'object' && record.meta != null
    ? record.meta as Record<string, unknown>
    : {}
  const picUrl = canonicalPictureUrl(record)
  const meta: Record<string, unknown> = {
    ...existingMeta,
    songId: existingMeta.songId ?? record.songmid ?? record.id,
    albumName: existingMeta.albumName ?? record.albumName,
    albumId: existingMeta.albumId ?? record.albumId,
    qualitys: existingMeta.qualitys ?? record.types,
    _qualitys: existingMeta._qualitys ?? record._types,
    ...(picUrl == null ? {} : { picUrl }),
  }
  if (record.source === 'kg') meta.hash ??= record.hash
  if (record.source === 'tx') {
    meta.strMediaMid ??= record.strMediaMid
    meta.id ??= record.songId
    meta.albumMid ??= record.albumMid
  }
  if (record.source === 'mg') {
    meta.copyrightId ??= record.copyrightId
    meta.lrcUrl ??= record.lrcUrl
    meta.mrcUrl ??= record.mrcUrl
    meta.trcUrl ??= record.trcUrl
  }
  const compactMeta = Object.fromEntries(Object.entries(meta).filter(([, field]) => field != null))
  return { ...record, meta: compactMeta } as unknown as TuneFlow.Music.MusicInfoOnline
}

export const toSourceMusicInfo = (value: unknown): unknown => {
  const normalized = normalizeMusicInfo(value)
  if (typeof normalized !== 'object' || normalized == null || !('meta' in normalized)) return normalized
  const meta = normalized.meta
  if (typeof meta !== 'object' || meta == null || !('songId' in meta)) return value
  return toOldMusicInfo(normalized as TuneFlow.Music.MusicInfo)
}

export const toSourceMusicUrlInfo = (value: unknown, quality: TuneFlow.Quality): { type: TuneFlow.Quality, musicInfo: unknown } => {
  const info = typeof value === 'object' && value != null ? value as Record<string, unknown> : {}
  return {
    type: typeof info.type === 'string' ? info.type as TuneFlow.Quality : quality,
    musicInfo: toSourceMusicInfo('musicInfo' in info ? info.musicInfo : value),
  }
}
