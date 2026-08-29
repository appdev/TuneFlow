import { randomUUID } from 'node:crypto'
import type { PlaybackSession } from '../playback/historyRepository'
import type { CatalogSampler } from './catalogSampler'
import type { RecommendationRanker } from './ranker'
import type { SnapshotRepository } from './snapshotRepository'
import type { TasteRepository } from './tasteRepository'
import { classifyPlaybackSignal } from './tasteRepository'
import { recommendationPolicy } from './policy'
import type {
  DailyRecommendationResponse,
  RecommendationClearResult,
  RecommendationFeedbackInput,
  RecommendationFeedbackState,
  RecommendationStatusResponse,
} from './types'

export interface RecommendationServiceDependencies {
  sampler: CatalogSampler
  ranker: RecommendationRanker
  snapshots: SnapshotRepository
  taste: TasteRepository
  getTimeZone: () => string
  isPlayableProvider: (source: string) => boolean
  sourcePriority: (source: string) => number
  publish: (response: DailyRecommendationResponse) => void
  now?: () => number
  createId?: () => string
}

const localDateFor = (now: number, timeZone: string): string => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const get = (type: Intl.DateTimeFormatPartTypes): string => parts.find(part => part.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

const errorCode = (error: unknown): string => typeof error === 'object' && error != null && 'code' in error && typeof error.code === 'string'
  ? error.code
  : 'RECOMMENDATION_GENERATION_FAILED'

export class RecommendationService {
  private generation: Promise<DailyRecommendationResponse | null> | null = null
  private generationId: string | null = null
  private timer: NodeJS.Timeout | null = null
  private closed = false
  private readonly now: () => number
  private readonly createId: () => string

  constructor(private readonly dependencies: RecommendationServiceDependencies) {
    this.now = dependencies.now ?? Date.now
    this.createId = dependencies.createId ?? randomUUID
  }

  daily(): DailyRecommendationResponse {
    const localDate = this.localDate()
    const current = this.dependencies.snapshots.current(localDate)
    if (current == null) {
      this.ensureGeneration('daily')
      return { status: 'warming', localDate, version: null, generatedAt: null, sourceCoverage: [], items: [] }
    }
    return this.generation == null ? current : { ...current, status: 'generating' }
  }

  refresh(): { generationId: string, status: 'generating' } {
    this.ensureGeneration('refresh')
    return { generationId: this.generationId!, status: 'generating' }
  }

  status(): RecommendationStatusResponse {
    const localDate = this.localDate()
    const current = this.dependencies.snapshots.current(localDate)
    const job = this.dependencies.snapshots.lastJob(localDate)
    return {
      status: this.generation != null ? 'generating' : current?.status ?? 'warming',
      localDate,
      version: current?.version ?? null,
      generationId: this.generationId ?? job?.generationId ?? null,
      generatedAt: current?.generatedAt ?? null,
      sourceCoverage: current?.sourceCoverage ?? [],
      lastErrorCode: job?.errorCode ?? null,
    }
  }

  recordFeedback(input: RecommendationFeedbackInput): RecommendationFeedbackState {
    return this.dependencies.taste.recordFeedback(input)
  }

  recordResolveOutcome(event: { recommendationItemId: string, outcome: 'resolved' | 'unplayable' }): void {
    this.dependencies.snapshots.recordResolve(event.recommendationItemId, event.outcome)
  }

  recordPlaybackStart(session: PlaybackSession): void { this.dependencies.snapshots.recordPlaybackStart(session) }

  applyPlayback(session: PlaybackSession): void {
    this.dependencies.snapshots.recordPlaybackEnd(session, classifyPlaybackSignal(session))
    this.dependencies.taste.applyPlayback(session)
  }

  clearProfile(): RecommendationClearResult {
    const taste = this.dependencies.taste.clearProfile()
    const snapshot = this.dependencies.snapshots.clearProfileData()
    return { ...taste, ...snapshot }
  }

  start(): void {
    if (this.closed || process.env.NODE_ENV === 'test' || this.timer != null) return
    this.timer = setTimeout(() => {
      this.timer = null
      if (!this.closed) this.ensureGeneration('maintenance')
    }, 3_000)
    this.timer.unref()
  }

  async waitForIdle(): Promise<void> { await this.generation }

  async close(): Promise<void> {
    this.closed = true
    if (this.timer != null) clearTimeout(this.timer)
    this.timer = null
    this.dependencies.sampler.close()
    await this.waitForIdle()
  }

  private localDate(): string {
    let timeZone = this.dependencies.getTimeZone()
    if (timeZone === 'system') timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    try { return localDateFor(this.now(), timeZone) } catch { return localDateFor(this.now(), 'UTC') }
  }

  private ensureGeneration(mode: 'daily' | 'refresh' | 'maintenance'): void {
    if (this.closed || this.generation != null) return
    const generationId = this.createId()
    this.generationId = generationId
    const localDate = this.localDate()
    this.dependencies.snapshots.startJob(localDate, generationId)
    this.generation = this.generate(localDate, mode, generationId).finally(() => {
      this.generation = null
      this.generationId = null
    })
  }

  private async generate(localDate: string, mode: 'daily' | 'refresh' | 'maintenance', generationId: string): Promise<DailyRecommendationResponse | null> {
    try {
      this.dependencies.taste.syncExplicitFacts()
      const sample = await this.dependencies.sampler.run(mode === 'maintenance' || mode === 'refresh' ? 'daily' : 'bootstrap')
      const ranked = this.dependencies.ranker.rank({
        exposedToday: this.dependencies.snapshots.exposedToday(localDate),
        isPlayableProvider: this.dependencies.isPlayableProvider,
        sourcePriority: this.dependencies.sourcePriority,
        now: this.now(),
      })
      if (ranked.length < recommendationPolicy.minimumPublishSize) {
        this.dependencies.snapshots.finishJob(generationId, 'failed', 'INSUFFICIENT_RECOMMENDATION_CANDIDATES')
        const current = this.dependencies.snapshots.current(localDate)
        if (current != null) this.dependencies.publish(current)
        return current
      }
      const coverageDegraded = sample.eligibleSources.length === 0 || sample.sourceCoverage.length < sample.eligibleSources.length
      const status = sample.failedSources.length === 0 && !coverageDegraded ? 'ready' : 'degraded'
      const degradationCode = sample.failedSources[0] ?? (coverageDegraded ? 'RECOMMENDATION_SOURCE_COVERAGE_DEGRADED' : null)
      const response = this.dependencies.snapshots.publish(localDate, status, sample.sourceCoverage, ranked)
      this.dependencies.snapshots.finishJob(generationId, status, degradationCode)
      this.dependencies.publish(response)
      return response
    } catch (error) {
      this.dependencies.snapshots.finishJob(generationId, 'failed', errorCode(error))
      const current = this.dependencies.snapshots.current(localDate)
      if (current != null) this.dependencies.publish(current)
      return current
    }
  }
}
