export type RecommendationStatus = 'warming' | 'generating' | 'ready' | 'degraded'
export type RecommendationBucket = 'new' | 'familiar'

export interface RecommendationItem {
  recommendationItemId: string
  canonicalTrackId: string
  track: TuneFlow.Music.MusicInfoOnline
  bucket: RecommendationBucket
  reason: {
    type: 'playlist_cooccurrence' | 'artist_affinity' | 'album_affinity' | 'tag_affinity' | 'familiar_replay' | 'exploration'
    seedTrackName?: string
    labels: string[]
  }
}

export interface DailyRecommendationResponse {
  status: RecommendationStatus
  localDate: string
  version: number | null
  generatedAt: number | null
  sourceCoverage: string[]
  items: RecommendationItem[]
}

const request = async<T>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, init)
  const body = await response.json() as { data?: T, error?: { message?: string } }
  if (!response.ok || body.data == null) throw new Error(body.error?.message ?? `Recommendation request failed (${response.status})`)
  return body.data
}

const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

export const getDailyRecommendations = async(): Promise<DailyRecommendationResponse> => await request('/api/v1/recommendations/daily')
export const refreshDailyRecommendations = async(): Promise<{ generationId: string, status: 'generating' }> => await request('/api/v1/recommendations/daily/refresh', { method: 'POST' })
export const sendRecommendationFeedback = async(input: { type: 'not_interested_track', track: TuneFlow.Music.MusicInfoOnline }): Promise<{ feedbackId: string, active: boolean }> => await request('/api/v1/recommendations/feedback', json(input))
export const clearRecommendationProfile = async(): Promise<{ profile: number, feedback: number, exposure: number, snapshots: number }> => await request('/api/v1/recommendations/profile', { method: 'DELETE' })
