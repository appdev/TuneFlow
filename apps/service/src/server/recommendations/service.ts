import { randomUUID } from 'node:crypto'
import type { PlaybackSession } from '../playback/historyRepository'
import type { CatalogSampler } from './catalogSampler'
import type { RecommendationRanker } from './ranker'
import type { SnapshotRepository } from './snapshotRepository'
import type { TasteRepository } from './tasteRepository'
import { classifyPlaybackSignal, toTasteTrackPattern } from './tasteRepository'
import { recommendationPolicy } from './policy'
import type { MusicBrainzEnricher } from './musicBrainzEnricher'
import { canonicalizeTrack } from './identity'
import type {
  DailyRecommendationResponse,
  RecommendationClearResult,
  RecommendationFeedbackInput,
  RecommendationFeedbackState,
  MusicBrainzConnectionTestResult,
  RecommendationStatusResponse,
} from './types'

export interface RecommendationServiceDependencies {
  sampler: CatalogSampler
  ranker: RecommendationRanker
  snapshots: SnapshotRepository
  taste: TasteRepository
  getTimeZone: () => string
  getMusicBrainzBaseUrl?: () => string
  musicBrainzEnricher?: MusicBrainzEnricher
  isPlayableProvider: (source: string) => boolean
  sourcePriority: (source: string) => number
  publish: (response: DailyRecommendationResponse) => void
  testMusicBrainzConnection?: (baseUrl: string) => Promise<MusicBrainzConnectionTestResult>
  clearAdditionalProfileData?: () => void
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
  private retryAttempt = 0
  private retryLocalDate: string | null = null

  constructor(private readonly dependencies: RecommendationServiceDependencies) {
    this.now = dependencies.now ?? Date.now
    this.createId = dependencies.createId ?? randomUUID
  }

  daily(): DailyRecommendationResponse {
    const localDate = this.localDate()
    if (this.musicBrainzBaseUrl() === '') return this.emptyResponse('disabled', localDate)
    const current = this.dependencies.snapshots.current(localDate)
    if (current == null) {
      this.ensureGeneration('daily')
      const stale = this.dependencies.snapshots.latestComplete()
      if (stale != null) return this.visible({ ...stale, status: 'stale', localDate, snapshotLocalDate: stale.localDate, lastErrorCode: this.dependencies.snapshots.lastJob(localDate)?.errorCode ?? null })
      return this.emptyResponse('warming', localDate)
    }
    return this.visible(this.generation == null ? current : { ...current, status: 'generating' })
  }

  refresh(): { generationId: string, status: 'generating' } {
    if (this.musicBrainzBaseUrl() === '') throw Object.assign(new Error('RECOMMENDATION_DISABLED'), { code: 'RECOMMENDATION_DISABLED' })
    this.ensureGeneration('refresh')
    return { generationId: this.generationId!, status: 'generating' }
  }

  status(): RecommendationStatusResponse {
    const localDate = this.localDate()
    if (this.musicBrainzBaseUrl() === '') return { ...this.emptyResponse('disabled', localDate), generationId: null }
    const current = this.dependencies.snapshots.current(localDate)
    const stale = current == null ? this.dependencies.snapshots.latestComplete() : null
    const job = this.dependencies.snapshots.lastJob(localDate)
    return {
      status: this.generation != null ? 'generating' : current?.status ?? (stale == null ? 'warming' : 'stale'),
      localDate,
      snapshotLocalDate: current?.localDate ?? stale?.localDate ?? null,
      version: current?.version ?? stale?.version ?? null,
      generationId: this.generationId ?? job?.generationId ?? null,
      generatedAt: current?.generatedAt ?? stale?.generatedAt ?? null,
      sourceCoverage: current?.sourceCoverage ?? stale?.sourceCoverage ?? [],
      lastErrorCode: job?.errorCode ?? null,
    }
  }

  recordFeedback(input: RecommendationFeedbackInput): RecommendationFeedbackState {
    const feedback = this.dependencies.taste.recordFeedback(input)
    const localDate = this.localDate()
    const current = this.dependencies.snapshots.current(localDate)
    const stored = current ?? this.dependencies.snapshots.latestComplete()
    if (stored != null) {
      const response = current == null
        ? { ...stored, status: 'stale' as const, localDate, snapshotLocalDate: stored.localDate, lastErrorCode: this.dependencies.snapshots.lastJob(localDate)?.errorCode ?? null }
        : stored
      this.dependencies.publish(this.visible(response))
    }
    return feedback
  }

  async testMusicBrainzConnection(baseUrl: string): Promise<MusicBrainzConnectionTestResult> {
    if (this.dependencies.testMusicBrainzConnection == null) return { ok: false, normalizedBaseUrl: baseUrl.trim(), errorCode: 'unavailable' }
    return await this.dependencies.testMusicBrainzConnection(baseUrl)
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
    this.dependencies.clearAdditionalProfileData?.()
    return { ...taste, ...snapshot }
  }

  start(): void {
    if (this.closed || process.env.NODE_ENV === 'test' || this.timer != null) return
    this.timer = setTimeout(() => {
      this.timer = null
      const localDate = this.localDate()
      if (!this.closed && this.musicBrainzBaseUrl() !== '' && this.dependencies.snapshots.current(localDate) == null) this.ensureGeneration('maintenance')
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
    if (this.closed || this.generation != null || this.musicBrainzBaseUrl() === '') return
    const localDate = this.localDate()
    if (mode !== 'refresh' && this.dependencies.snapshots.current(localDate) != null) return
    const generationId = this.createId()
    this.generationId = generationId
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
      const enrichment = this.dependencies.musicBrainzEnricher == null
        ? { evidence: new Map(), errorCode: null }
        : await this.dependencies.musicBrainzEnricher.enrich(
          this.musicBrainzBaseUrl(),
          this.dependencies.taste.seeds(50),
          this.dependencies.ranker.catalogCandidates(this.now()),
        )
      const ranked = this.dependencies.ranker.rank({
        excludedCanonicalIds: mode === 'refresh' ? this.dependencies.snapshots.currentCanonicalIds(localDate) : new Set(),
        musicBrainzEvidence: enrichment.evidence,
        isPlayableProvider: this.dependencies.isPlayableProvider,
        sourcePriority: this.dependencies.sourcePriority,
        now: this.now(),
      })
      if (ranked.length < recommendationPolicy.minimumPublishSize) {
        this.dependencies.snapshots.finishJob(generationId, 'failed', 'INSUFFICIENT_RECOMMENDATION_CANDIDATES')
        const current = this.dependencies.snapshots.current(localDate)
        if (current != null) this.dependencies.publish(this.visible(current))
        this.scheduleRetry(localDate)
        return current
      }
      const coverageDegraded = sample.eligibleSources.length === 0 || sample.sourceCoverage.length < sample.eligibleSources.length
      const status = sample.failedSources.length === 0 && !coverageDegraded && enrichment.errorCode == null ? 'ready' : 'degraded'
      const degradationCode = enrichment.errorCode ?? sample.failedSources[0] ?? (coverageDegraded ? 'RECOMMENDATION_SOURCE_COVERAGE_DEGRADED' : null)
      const stored = this.dependencies.snapshots.publish(localDate, status, sample.sourceCoverage, ranked)
      const response = this.visible(stored)
      this.dependencies.snapshots.finishJob(generationId, status, degradationCode)
      this.dependencies.publish(response)
      this.resetRetry(localDate)
      return response
    } catch (error) {
      this.dependencies.snapshots.finishJob(generationId, 'failed', errorCode(error))
      const current = this.dependencies.snapshots.current(localDate)
      if (current != null) this.dependencies.publish(this.visible(current))
      this.scheduleRetry(localDate)
      return current
    }
  }

  private musicBrainzBaseUrl(): string { return this.dependencies.getMusicBrainzBaseUrl?.() ?? 'https://musicbrainz.org/ws/2/' }

  private emptyResponse(status: 'warming' | 'generating' | 'disabled', localDate: string): DailyRecommendationResponse {
    return { status, localDate, snapshotLocalDate: null, version: null, generatedAt: null, lastErrorCode: null, sourceCoverage: [], items: [] }
  }

  private visible(response: DailyRecommendationResponse): DailyRecommendationResponse {
    const exclusions = typeof this.dependencies.taste.exclusions === 'function'
      ? this.dependencies.taste.exclusions()
      : { tracks: new Set<string>(), artists: new Set<string>(), titles: new Set<string>(), trackPatterns: new Set<string>() }
    const interested = typeof this.dependencies.taste.interestedFeedback === 'function'
      ? this.dependencies.taste.interestedFeedback()
      : new Map<string, string>()
    return {
      ...response,
      items: response.items.filter(item => {
        if (exclusions.tracks.has(item.canonicalTrackId)) return false
        const canonical = canonicalizeTrack(item.track)
        if (canonical == null) return true
        if (exclusions.titles.has(canonical.normalizedTitle)) return false
        if (canonical.normalizedArtists.some(artist => exclusions.artists.has(artist))) return false
        return !exclusions.trackPatterns.has(toTasteTrackPattern(canonical.normalizedTitle, canonical.normalizedArtists))
      }).map(item => {
        const interestedFeedbackId = interested.get(item.canonicalTrackId) ?? null
        return { ...item, feedback: { interested: interestedFeedbackId != null, interestedFeedbackId } }
      }),
    }
  }

  private resetRetry(localDate: string): void {
    this.retryLocalDate = localDate
    this.retryAttempt = 0
  }

  private scheduleRetry(localDate: string): void {
    if (process.env.NODE_ENV === 'test' || this.closed || this.timer != null || this.dependencies.snapshots.current(localDate) != null) return
    if (this.retryLocalDate !== localDate) this.resetRetry(localDate)
    const delays = [15 * 60_000, 60 * 60_000, 4 * 60 * 60_000]
    const wait = delays[Math.min(this.retryAttempt, delays.length - 1)]
    this.retryAttempt += 1
    this.timer = setTimeout(() => {
      this.timer = null
      if (!this.closed && this.localDate() === localDate) this.ensureGeneration('maintenance')
    }, wait)
    this.timer.unref()
  }
}
