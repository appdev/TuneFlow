import { createHash } from 'node:crypto'
import type { CanonicalTrack, RecommendationTrack, TrackVariant } from './types'

const editionPatterns = [
  ['live', /(?:\blive\b|现场|現場)/iu],
  ['remix', /(?:\bremix\b|混音)/iu],
  ['acoustic', /(?:\bacoustic\b|不插电|不插電)/iu],
  ['instrumental', /(?:\binstrumental\b|伴奏|纯音乐|純音樂)/iu],
  ['cover', /(?:\bcover\b|翻唱)/iu],
] as const

export const normalizeLabel = (value: string): string => value
  .normalize('NFKC')
  .toLocaleLowerCase()
  .replace(/[\p{P}\p{S}]+/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim()

export const normalizeArtistIdentity = (value: string): string[] => [...new Set(value
  .normalize('NFKC')
  .replace(/\b(?:feat(?:uring)?|ft)\.?\b/giu, ',')
  .split(/[,/&;、，·×]|\s+x\s+/iu)
  .map(normalizeLabel)
  .filter(Boolean))].sort()

export const extractEditionMarker = (title: string): string => editionPatterns
  .filter(([, pattern]) => pattern.test(title))
  .map(([marker]) => marker)
  .sort()
  .join('+')

const normalizeTitleWithoutEdition = (title: string): string => {
  let value = title
  for (const [, pattern] of editionPatterns) value = value.replace(pattern, ' ')
  return normalizeLabel(value)
}

const readAlbumName = (track: Record<string, unknown>): string => {
  if (typeof track.albumName === 'string') return track.albumName
  if (typeof track.meta !== 'object' || track.meta == null) return ''
  const album = (track.meta as Record<string, unknown>).albumName
  return typeof album === 'string' ? album : ''
}

export const asRecommendationTrack = (track: Record<string, unknown>): RecommendationTrack | null => {
  const id = typeof track.id === 'string' || typeof track.id === 'number' ? String(track.id) : ''
  const source = typeof track.source === 'string' ? track.source : ''
  const name = typeof track.name === 'string' ? track.name.trim() : ''
  const singer = typeof track.singer === 'string' ? track.singer.trim() : ''
  if (id === '' || source === '' || name === '' || singer === '') return null
  return { ...track, id, source, name, singer }
}

export const canonicalizeTrack = (track: Record<string, unknown>): CanonicalTrack | null => {
  const safe = asRecommendationTrack(track)
  if (safe == null) return null
  const normalizedTitle = normalizeTitleWithoutEdition(safe.name)
  const normalizedArtists = normalizeArtistIdentity(safe.singer)
  if (normalizedTitle === '' || normalizedArtists.length === 0) return null
  const versionMarker = extractEditionMarker(safe.name)
  const normalizedAlbum = normalizeLabel(readAlbumName(safe))
  const key = ['v1', normalizedTitle, normalizedArtists.join('\u001f'), versionMarker].join('\u001e')
  return {
    canonicalTrackId: createHash('sha256').update(key).digest('hex'),
    normalizedTitle,
    normalizedArtists,
    normalizedAlbum,
    versionMarker,
  }
}

export const toTrackVariant = (track: Record<string, unknown>, now = Date.now()): TrackVariant | null => {
  const safe = asRecommendationTrack(track)
  const canonical = canonicalizeTrack(track)
  if (safe == null || canonical == null) return null
  const metadataQuality = Math.min(1, 0.5 + (readAlbumName(track) === '' ? 0 : 0.2) + (typeof track.img === 'string' ? 0.15 : 0) + (typeof track.interval === 'string' ? 0.15 : 0))
  return {
    canonicalTrackId: canonical.canonicalTrackId,
    source: safe.source,
    sourceTrackId: safe.id,
    track: safe,
    metadataQuality,
    lastSeenAt: now,
  }
}
