import type { RecommendationItem } from '../Recommendations/api'

export type RadioMode = 'dedicated' | 'queue_continuation'
export type RadioAIStatus = 'enhanced' | 'profile_only' | 'local' | 'disabled' | 'unavailable'

export interface RadioItem extends RecommendationItem {
  radioSessionId: string
  rankingSource: 'ai' | 'ai_profile_local_rank' | 'local' | 'daily_fallback' | 'familiar_fallback'
}

export interface RadioBatchRequest {
  requestId: string
  queueGeneration: number
  currentTrack: TuneFlow.Music.MusicInfoOnline | null
  queuedTracks: TuneFlow.Music.MusicInfoOnline[]
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

const request = async<T>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, init)
  const body = await response.json() as { data?: T, error?: { message?: string } }
  if (!response.ok || body.data == null) throw new Error(body.error?.message ?? `Radio request failed (${response.status})`)
  return body.data
}
const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

export const createRadioSession = async(mode: RadioMode, batch: RadioBatchRequest): Promise<RadioBatchResponse> => await request('/api/v1/radio/sessions', json({ mode, ...batch }))
export const nextRadioBatch = async(sessionId: string, batch: RadioBatchRequest): Promise<RadioBatchResponse> => await request(`/api/v1/radio/sessions/${encodeURIComponent(sessionId)}/next`, json(batch))
export const closeRadioSession = async(sessionId: string): Promise<void> => { await request(`/api/v1/radio/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' }) }
