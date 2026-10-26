import type { PlaybackSession } from '../playback/historyRepository'
import type { TasteRepository } from '../recommendations/tasteRepository'
import type { AIPlaybackEntry, AIProfileInput } from './types'

const text = (value: unknown): string => typeof value === 'string' ? value : ''
const trackAlbum = (track: Record<string, unknown>): string => {
  if (typeof track.album === 'string') return track.album
  const meta = typeof track.meta === 'object' && track.meta != null && !Array.isArray(track.meta) ? track.meta as Record<string, unknown> : null
  return text(meta?.albumName)
}

export const projectAIPlayback = (session: PlaybackSession): AIPlaybackEntry | null => {
  if (session.endedAt == null) return null
  return {
    playbackId: session.playbackId,
    track: {
      id: session.track.id,
      source: session.track.source,
      name: text(session.track.name),
      singer: text(session.track.singer),
      album: trackAlbum(session.track),
    },
    platform: session.platform,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    completed: session.completed,
    lastPositionSeconds: session.lastPositionSeconds,
    durationSeconds: session.durationSeconds,
    recommendationItemId: session.recommendationItemId,
  }
}

export const buildAIProfileInput = (options: {
  history: PlaybackSession[]
  taste: TasteRepository
  now: number
  timeZone: string
}): AIProfileInput => {
  const exclusions = options.taste.exclusions()
  return {
    timeZone: options.timeZone,
    generatedAt: options.now,
    detailedHistoryRangeDays: 30,
    playbackHistory: options.history.flatMap(session => {
      const projected = projectAIPlayback(session)
      return projected == null ? [] : [projected]
    }),
    longTermProfile: options.taste.snapshot(),
    explicitFeedback: [
      ...[...exclusions.tracks].map(identity => ({ type: 'track' as const, identity })),
      ...[...exclusions.artists].map(identity => ({ type: 'artist' as const, identity })),
    ],
  }
}
