import { createHash, randomUUID } from 'node:crypto'
import type { PlaybackSession } from '../playback/historyRepository'
import { canonicalizeTrack } from '../recommendations/identity'
import type { RankedRecommendation, RecommendationTrack } from '../recommendations/types'
import { classifyPlaybackSignal } from '../recommendations/tasteRepository'
import type { SnapshotRepository } from '../recommendations/snapshotRepository'
import type { AIProfileAnalyzer } from './aiProfileAnalyzer'
import type { AIProfileRepository } from './aiProfileRepository'
import type {
  AIProvider,
  AIServiceStatus,
  RadioAIStatus,
  RadioBatchRequest,
  RadioBatchResponse,
  RadioItem,
  RadioMode,
  RadioRankingSource,
} from './types'
import type { AICandidateReranker } from './aiReranker'
import type { RadioCandidateGenerator } from './candidateGenerator'
import { radioPolicy } from './policy'
import type { RadioSessionRepository } from './sessionRepository'

export interface RadioServiceConfiguration {
  enabled: boolean
  configured: boolean
  provider: string
  model: string
}

interface RadioServiceDependencies {
  sessions: RadioSessionRepository
  generator: RadioCandidateGenerator
  analyzer: AIProfileAnalyzer
  reranker: AICandidateReranker
  profiles: AIProfileRepository
  provider: AIProvider
  snapshots: SnapshotRepository
  getConfiguration: () => RadioServiceConfiguration
  isPlayableProvider: (source: string) => boolean
  sourcePriority: (source: string) => number
  now?: () => number
  getLocalHour?: (now: number) => number
  createId?: () => string
}

const trackIds = (tracks: RecommendationTrack[]): Set<string> => new Set(tracks.flatMap(track => {
  const canonical = canonicalizeTrack(track)
  return canonical == null ? [] : [canonical.canonicalTrackId]
}))

const rankingSource = (ai: boolean, profile: boolean): RadioRankingSource => ai ? 'ai' : profile ? 'ai_profile_local_rank' : 'local'

export class RadioService {
  private readonly now: () => number
  private readonly createId: () => string

  constructor(private readonly dependencies: RadioServiceDependencies) {
    this.now = dependencies.now ?? Date.now
    this.createId = dependencies.createId ?? randomUUID
  }

  async create(mode: RadioMode, request: RadioBatchRequest): Promise<RadioBatchResponse> {
    const profile = await this.dependencies.analyzer.currentOrRefresh()
    const session = this.dependencies.sessions.create({
      mode,
      initialTrack: request.currentTrack,
      profileId: profile.profileId,
      policyVersion: radioPolicy.version,
    })
    return await this.generate(session.sessionId, mode, request, profile)
  }

  async next(sessionId: string, request: RadioBatchRequest): Promise<RadioBatchResponse> {
    const existing = this.dependencies.sessions.findBatch(sessionId, request)
    if (existing != null) return existing
    const session = this.dependencies.sessions.getActive(sessionId)
    if (session == null) throw Object.assign(new Error('RADIO_SESSION_NOT_ACTIVE'), { code: 'RADIO_SESSION_NOT_ACTIVE' })
    const profile = await this.dependencies.analyzer.currentOrRefresh()
    return await this.generate(sessionId, session.mode, request, profile)
  }

  get(sessionId: string): RadioBatchResponse {
    const session = this.dependencies.sessions.getActive(sessionId)
    if (session == null) throw Object.assign(new Error('RADIO_SESSION_NOT_ACTIVE'), { code: 'RADIO_SESSION_NOT_ACTIVE' })
    return this.dependencies.sessions.latestBatch(sessionId) ?? {
      sessionId,
      mode: session.mode,
      status: 'degraded',
      aiStatus: this.aiStatus(this.dependencies.analyzer.current(), false),
      profileId: session.profileId,
      items: [],
    }
  }

  close(sessionId: string): void {
    if (!this.dependencies.sessions.close(sessionId)) throw Object.assign(new Error('RADIO_SESSION_NOT_ACTIVE'), { code: 'RADIO_SESSION_NOT_ACTIVE' })
  }

  recordResolveOutcome(event: { recommendationItemId: string, outcome: 'resolved' | 'unplayable' }): void {
    this.dependencies.sessions.recordResolve(event.recommendationItemId, event.outcome)
  }

  recordPlaybackStart(session: PlaybackSession): void {
    this.dependencies.sessions.recordPlaybackStart(session)
  }

  recordPlaybackEnd(session: PlaybackSession): void {
    this.dependencies.sessions.recordPlaybackEnd(session, classifyPlaybackSignal(session))
  }

  async reanalyzeProfile(): Promise<AIServiceStatus> {
    await this.dependencies.analyzer.currentOrRefresh({ force: true })
    return this.status()
  }

  status(): AIServiceStatus {
    const config = this.dependencies.getConfiguration()
    const current = this.dependencies.analyzer.current()
    const stored = config.configured
      ? this.dependencies.profiles.latest({ provider: config.provider, model: config.model, promptVersion: radioPolicy.promptVersion, minimumGeneratedAt: 0 })
      : null
    const lastRun = this.dependencies.profiles.latestRun('profile')
    return {
      enabled: config.enabled,
      configured: config.configured,
      healthy: !config.enabled || (config.configured && lastRun?.status !== 'failed'),
      profileId: current.profileId,
      profileSource: current.source,
      generatedAt: stored?.generatedAt ?? null,
      lastErrorCode: current.errorCode ?? lastRun?.errorCode ?? null,
    }
  }

  async testConnection(): Promise<{ ok: boolean, errorCode: string | null }> {
    const config = this.dependencies.getConfiguration()
    const startedAt = this.now()
    const result = await this.dependencies.provider.testConnection()
    const finishedAt = this.now()
    this.dependencies.profiles.recordRun({
      runId: this.createId(),
      purpose: 'connection_test',
      startedAt,
      finishedAt,
      provider: config.provider,
      model: config.model,
      inputFingerprint: createHash('sha256').update(`${config.provider}\0${config.model}`).digest('hex'),
      candidateCount: 0,
      status: result.ok ? 'complete' : 'failed',
      errorCode: result.errorCode,
    })
    return result
  }

  clear(): { sessions: number, ai: number } {
    return { sessions: this.dependencies.sessions.clear(), ai: this.dependencies.profiles.clear() }
  }

  private async generate(
    sessionId: string,
    mode: RadioMode,
    request: RadioBatchRequest,
    profile: Awaited<ReturnType<AIProfileAnalyzer['currentOrRefresh']>>,
  ): Promise<RadioBatchResponse> {
    const now = this.now()
    const localHour = this.dependencies.getLocalHour?.(now) ?? new Date(now).getUTCHours()
    const fallbackItems = this.dependencies.snapshots.latestComplete()?.items ?? []
    const candidates = this.dependencies.generator.pool({
      currentTrack: request.currentTrack,
      queuedCanonicalIds: trackIds(request.queuedTracks),
      exposedCanonicalIds: this.dependencies.sessions.exposedCanonicalIds(sessionId),
      recentSessionItems: this.dependencies.sessions.recentItems(sessionId),
      profile: profile.profile,
      fallbackItems,
      isPlayableProvider: this.dependencies.isPlayableProvider,
      sourcePriority: this.dependencies.sourcePriority,
      now,
      localHour,
      limit: request.limit,
    })
    const reranked = await this.dependencies.reranker.rerank({
      profileId: profile.profileId,
      profile: profile.profile,
      currentTrack: request.currentTrack,
      recentItems: this.dependencies.sessions.recentItems(sessionId),
      candidates,
      localHour,
    })
    const selected = this.dependencies.generator.select(reranked.ordered, request.limit)
    const source = rankingSource(reranked.source === 'ai', profile.profile != null)
    const response: RadioBatchResponse = {
      sessionId,
      mode,
      status: selected.length === 0 || reranked.errorCode != null || profile.errorCode != null ? 'degraded' : 'active',
      aiStatus: this.aiStatus(profile, reranked.source === 'ai'),
      profileId: profile.profileId,
      items: selected.map(item => this.toRadioItem(sessionId, item, source)),
    }
    return this.dependencies.sessions.publishBatch(response, request)
  }

  private toRadioItem(sessionId: string, item: RankedRecommendation, source: RadioRankingSource): RadioItem {
    return {
      recommendationItemId: this.createId(),
      radioSessionId: sessionId,
      canonicalTrackId: item.canonicalTrackId,
      track: item.variant.track,
      bucket: item.bucket,
      reason: item.reason,
      feedback: { interested: false, interestedFeedbackId: null },
      rankingSource: source,
    }
  }

  private aiStatus(profile: Awaited<ReturnType<AIProfileAnalyzer['currentOrRefresh']>>, reranked: boolean): RadioAIStatus {
    const config = this.dependencies.getConfiguration()
    if (!config.enabled) return 'disabled'
    if (!config.configured) return 'unavailable'
    if (reranked) return 'enhanced'
    if (profile.profile != null) return 'profile_only'
    return profile.errorCode == null ? 'local' : 'unavailable'
  }
}
