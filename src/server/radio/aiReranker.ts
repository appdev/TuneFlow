import { createHash, randomUUID } from 'node:crypto'
import type { RankedRecommendation } from '../recommendations/types'
import { aiErrorCode } from './aiClient'
import type { AIProfileRepository } from './aiProfileRepository'
import { radioPolicy } from './policy'
import type { AIProfile, AIProvider, AIRerankInput, RadioSessionItem } from './types'

export interface ConstrainedRerank {
  ordered: RankedRecommendation[]
  source: 'ai' | 'local'
  errorCode: string | null
}

interface AIRerankerOptions {
  provider: AIProvider
  repository: AIProfileRepository
  getConfiguration: () => { enabled: boolean, configured: boolean, provider: string, model: string }
  now?: () => number
  createId?: () => string
}

interface CacheEntry { expiresAt: number, result: ConstrainedRerank }
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex')

export class AICandidateReranker {
  private readonly cache = new Map<string, CacheEntry>()
  private readonly pending = new Map<string, Promise<ConstrainedRerank>>()
  private failureCount = 0
  private circuitUntil = 0
  private calls: number[] = []
  private readonly now: () => number
  private readonly createId: () => string

  constructor(private readonly options: AIRerankerOptions) {
    this.now = options.now ?? Date.now
    this.createId = options.createId ?? randomUUID
  }

  async rerank(options: { profileId: string | null, profile: AIProfile | null, currentTrack: Record<string, unknown> | null, recentItems: RadioSessionItem[], candidates: RankedRecommendation[], localHour?: number }): Promise<ConstrainedRerank> {
    const config = this.options.getConfiguration()
    if (!config.enabled) return { ordered: options.candidates, source: 'local', errorCode: null }
    if (!config.configured) return { ordered: options.candidates, source: 'local', errorCode: 'AI_NOT_CONFIGURED' }
    const now = this.now()
    if (this.circuitUntil > now) return { ordered: options.candidates, source: 'local', errorCode: 'AI_CIRCUIT_OPEN' }
    this.calls = this.calls.filter(time => time > now - 60 * 60_000)
    if (this.calls.length >= radioPolicy.maxHourlyReranks) return { ordered: options.candidates, source: 'local', errorCode: 'AI_BUDGET_EXHAUSTED' }
    const localHour = options.localHour ?? new Date(now).getUTCHours()
    const key = hash({ profileId: options.profileId, current: options.currentTrack, hour: localHour, recent: options.recentItems.slice(-3).map(item => [item.canonicalTrackId, item.state]), candidates: options.candidates.map(item => item.canonicalTrackId) })
    const cached = this.cache.get(key)
    if (cached != null && cached.expiresAt >= now) return cached.result
    const existing = this.pending.get(key)
    if (existing != null) return await existing
    const operation = this.request(config, key, options).finally(() => { this.pending.delete(key) })
    this.pending.set(key, operation)
    return await operation
  }

  private async request(config: { provider: string, model: string }, key: string, options: { profileId: string | null, profile: AIProfile | null, currentTrack: Record<string, unknown> | null, recentItems: RadioSessionItem[], candidates: RankedRecommendation[], localHour?: number }): Promise<ConstrainedRerank> {
    const startedAt = this.now()
    const runId = this.createId()
    const mapped = options.candidates.map((candidate, index) => ({ candidateId: `candidate-${index}`, candidate }))
    const input: AIRerankInput = {
      profile: options.profile,
      currentTrack: options.currentTrack == null ? null : { name: String(options.currentTrack.name ?? ''), singer: String(options.currentTrack.singer ?? ''), album: String(options.currentTrack.album ?? '') },
      localHour: options.localHour ?? new Date(startedAt).getUTCHours(),
      recentOutcomes: options.recentItems.slice(-5).map(item => ({ state: item.state, name: item.track.name, singer: item.track.singer })),
      candidates: mapped.map(({ candidateId, candidate }) => ({ candidateId, name: candidate.variant.track.name, singer: candidate.variant.track.singer, album: String(candidate.variant.track.albumName ?? ''), source: candidate.variant.source, localScore: candidate.score, reason: candidate.reason })),
    }
    const inputFingerprint = hash(input)
    this.calls.push(startedAt)
    try {
      const response = await this.options.provider.rerank(input)
      const byId = new Map(mapped.map(item => [item.candidateId, item.candidate]))
      if (response.ranking.some(item => !byId.has(item.candidateId))) throw Object.assign(new Error('AI_UNKNOWN_CANDIDATE'), { code: 'AI_UNKNOWN_CANDIDATE' })
      const ordered = response.ranking.map(item => byId.get(item.candidateId)!)
      const included = new Set(ordered.map(item => item.canonicalTrackId))
      ordered.push(...options.candidates.filter(item => !included.has(item.canonicalTrackId)))
      const result: ConstrainedRerank = { ordered, source: 'ai', errorCode: null }
      this.failureCount = 0
      this.circuitUntil = 0
      this.cache.set(key, { expiresAt: this.now() + radioPolicy.rerankCacheMs, result })
      this.options.repository.recordRun({ runId, purpose: 'rerank', startedAt, finishedAt: this.now(), provider: config.provider, model: config.model, inputFingerprint, candidateCount: options.candidates.length, status: 'complete', errorCode: null })
      return result
    } catch (error) {
      const code = typeof error === 'object' && error != null && 'code' in error && typeof error.code === 'string' ? error.code : aiErrorCode(error)
      this.failureCount += 1
      if (this.failureCount >= radioPolicy.circuitFailureThreshold) this.circuitUntil = this.now() + radioPolicy.circuitCooldownMs
      this.options.repository.recordRun({ runId, purpose: 'rerank', startedAt, finishedAt: this.now(), provider: config.provider, model: config.model, inputFingerprint, candidateCount: options.candidates.length, status: 'failed', errorCode: code })
      return { ordered: options.candidates, source: 'local', errorCode: code }
    }
  }
}
