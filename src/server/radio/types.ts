import type { PlaybackPlatform } from '../playback/historyRepository'
import type { RecommendationItem, RecommendationReason, RecommendationTagKind, RecommendationTrack } from '../recommendations/types'

export type RadioMode = 'dedicated' | 'queue_continuation'
export type RadioRankingSource = 'ai' | 'ai_profile_local_rank' | 'local' | 'daily_fallback' | 'familiar_fallback'
export type RadioAIStatus = 'enhanced' | 'profile_only' | 'local' | 'disabled' | 'unavailable'
export type RadioSessionStatus = 'active' | 'closed' | 'expired'
export type RadioItemState = 'offered' | 'queued' | 'started' | 'completed' | 'skipped' | 'rejected' | 'unplayable'

export interface RadioItem extends RecommendationItem {
  radioSessionId: string
  rankingSource: RadioRankingSource
}

export interface RadioBatchRequest {
  requestId: string
  queueGeneration: number
  currentTrack: RecommendationTrack | null
  queuedTracks: RecommendationTrack[]
  limit: number
}

export interface RadioBatchResponse {
  sessionId: string
  mode: RadioMode
  status: 'active' | 'degraded'
  aiStatus: RadioAIStatus
  profileId: string | null
  items: RadioItem[]
}

export interface RadioSession {
  sessionId: string
  mode: RadioMode
  status: RadioSessionStatus
  startedAt: number
  lastActiveAt: number
  endedAt: number | null
  initialTrack: RecommendationTrack | null
  profileId: string | null
  policyVersion: string
}

export interface RadioSessionItem {
  sessionId: string
  sequence: number
  recommendationItemId: string
  canonicalTrackId: string
  track: RecommendationTrack
  state: RadioItemState
  rankingSource: RadioRankingSource
  reason: RecommendationReason
  generatedAt: number
  startedAt: number | null
  endedAt: number | null
  completionRatio: number | null
}

export interface TasteProfileSnapshot {
  tracks: Array<{ canonicalTrackId: string, score: number, playCount: number, completionCount: number, earlySkipCount: number }>
  artists: Array<{ identity: string, score: number }>
  albums: Array<{ identity: string, score: number }>
  tags: Array<{ kind: RecommendationTagKind, value: string, score: number }>
}

export interface AIPlaybackEntry {
  playbackId: string
  track: { id: string, source: string, name: string, singer: string, album: string }
  platform: PlaybackPlatform
  startedAt: number
  endedAt: number
  completed: boolean
  lastPositionSeconds: number | null
  durationSeconds: number | null
  recommendationItemId: string | null
}

export interface AIProfileInput {
  timeZone: string
  generatedAt: number
  detailedHistoryRangeDays: 30
  playbackHistory: AIPlaybackEntry[]
  longTermProfile: TasteProfileSnapshot
  explicitFeedback: Array<{ type: 'track' | 'artist', identity: string }>
}

export interface AITimePreference {
  startHour: number
  endHour: number
  genres: string[]
  artists: string[]
  energy: number
  explorationRatio: number
  confidence: number
}

export interface AIProfile {
  timePreferences: AITimePreference[]
  recentTrend: { genres: string[], strength: number }
  avoidPatterns: Array<{ type: 'artist_repeat' | 'genre_fatigue', value: string, strength: number }>
}

export type AIRerankFactor = 'time_fit' | 'current_track_transition' | 'recent_trend' | 'exploration' | 'familiarity'

export interface AIRerankCandidate {
  candidateId: string
  name: string
  singer: string
  album: string
  source: string
  localScore: number
  reason: RecommendationReason
}

export interface AIRerankInput {
  profile: AIProfile | null
  currentTrack: { name: string, singer: string, album: string } | null
  localHour: number
  recentOutcomes: Array<{ state: RadioItemState, name: string, singer: string }>
  candidates: AIRerankCandidate[]
}

export interface AIRerankResult {
  ranking: Array<{ candidateId: string, score: number, factors: AIRerankFactor[] }>
}

export interface AIProvider {
  analyzeProfile: (input: AIProfileInput) => Promise<AIProfile>
  rerank: (input: AIRerankInput) => Promise<AIRerankResult>
  testConnection: () => Promise<{ ok: boolean, errorCode: string | null }>
}

export interface ResolvedAIProfile {
  profileId: string | null
  profile: AIProfile | null
  source: 'fresh' | 'generated' | 'stale' | 'local'
  errorCode: string | null
}

export interface AIServiceStatus {
  enabled: boolean
  configured: boolean
  healthy: boolean
  profileId: string | null
  profileSource: ResolvedAIProfile['source']
  generatedAt: number | null
  lastErrorCode: string | null
}
