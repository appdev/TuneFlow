import { projectBrowserDto } from './browserDto'

export type PlaybackHistoryTrack = Record<string, unknown> & {
  id: string
  source: string
}

const privateKeys = new Set([
  'filepath',
  'path',
  'url',
  'headers',
  'authorization',
  'cookie',
  'token',
  'streamtoken',
])
const libraryStream = /^\/api\/v1\/library\/tracks\/[a-f\d]{64}\/stream$/

const sanitizeValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sanitizeValue)
  if (value == null || typeof value !== 'object') return value
  const result: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = key.toLowerCase()
    if (privateKeys.has(normalizedKey)) continue
    if (normalizedKey === 'streamurl') {
      if (typeof child === 'string' && libraryStream.test(child)) result[key] = child
      continue
    }
    result[key] = sanitizeValue(child)
  }
  return result
}

export const sanitizePlaybackTrack = (track: PlaybackHistoryTrack): PlaybackHistoryTrack => {
  const projected = projectBrowserDto(track)
  if (projected == null || typeof projected !== 'object' || Array.isArray(projected)) {
    throw new TypeError('Playback track projection is invalid')
  }
  return sanitizeValue(projected) as PlaybackHistoryTrack
}
