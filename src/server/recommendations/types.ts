export type RecommendationStatus = 'warming' | 'generating' | 'ready' | 'degraded' | 'stale' | 'disabled'
export type RecommendationBucket = 'new' | 'familiar'
export type RecommendationTagKind = 'genre' | 'mood' | 'scene'

export type RecommendationTrack = Record<string, unknown> & {
  id: string
  source: string
  name: string
  singer: string
}

export interface CanonicalTrack {
  canonicalTrackId: string
  normalizedTitle: string
  normalizedArtists: string[]
  normalizedAlbum: string
  versionMarker: string
}

export interface TrackVariant {
  canonicalTrackId: string
  source: string
  sourceTrackId: string
  track: RecommendationTrack
  metadataQuality: number
  lastSeenAt: number
}

export interface RecommendationReason {
  type: 'playlist_cooccurrence' | 'artist_affinity' | 'album_affinity' | 'tag_affinity' | 'familiar_replay' | 'exploration'
  seedTrackName?: string
  labels: string[]
}

export interface RecommendationItemFeedback {
  interested: boolean
  interestedFeedbackId: string | null
}

export interface RecommendationItem {
  recommendationItemId: string
  canonicalTrackId: string
  track: RecommendationTrack
  bucket: RecommendationBucket
  reason: RecommendationReason
  feedback?: RecommendationItemFeedback
}

export interface DailyRecommendationResponse {
  status: RecommendationStatus
  localDate: string
  snapshotLocalDate: string | null
  version: number | null
  generatedAt: number | null
  lastErrorCode: string | null
  sourceCoverage: string[]
  items: RecommendationItem[]
}

export interface RecommendationStatusResponse {
  status: RecommendationStatus
  localDate: string
  snapshotLocalDate: string | null
  version: number | null
  generationId: string | null
  generatedAt: number | null
  sourceCoverage: string[]
  lastErrorCode: string | null
}

export interface MusicBrainzConnectionTestResult {
  ok: boolean
  normalizedBaseUrl: string
  errorCode: string | null
}

export interface MusicBrainzRecording {
  recordingMbid: string
  title: string
  artists: string[]
  durationMs: number | null
  releaseGroupMbids: string[]
  workMbids: string[]
  firstReleaseDate: string | null
}

export interface MusicBrainzRecordingMatch {
  recording: MusicBrainzRecording
  method: 'isrc' | 'search'
  confidence: number
}

export type RecommendationFeedbackInput =
  | { type: 'interested_track', track: RecommendationTrack }
  | { type: 'not_interested_track', track: RecommendationTrack }
  | { type: 'not_interested_artist', artist: string }
  | { type: 'undo', feedbackId: string }

export interface RecommendationFeedbackState {
  feedbackId: string
  active: boolean
  type: RecommendationFeedbackInput['type']
}

export interface RecommendationClearResult {
  profile: number
  feedback: number
  exposure: number
  snapshots: number
}

export interface RecommendationTag {
  kind: RecommendationTagKind
  value: string
  confidence: number
  support: number
}

export interface RankedRecommendation {
  canonicalTrackId: string
  variant: TrackVariant
  bucket: RecommendationBucket
  reason: RecommendationReason
  score: number
}
