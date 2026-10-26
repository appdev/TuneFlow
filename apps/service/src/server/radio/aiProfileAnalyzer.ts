import { createHash, randomUUID } from 'node:crypto'
import { aiErrorCode } from './aiClient'
import type { AIProfileInput, AIProvider, ResolvedAIProfile } from './types'
import type { AIProfileRepository, StoredAIProfile } from './aiProfileRepository'
import { radioPolicy } from './policy'

export interface AIAnalyzerConfiguration {
  enabled: boolean
  configured: boolean
  provider: string
  model: string
}

interface AIProfileAnalyzerOptions {
  repository: AIProfileRepository
  provider: AIProvider
  getConfiguration: () => AIAnalyzerConfiguration
  buildInput: () => AIProfileInput
  now?: () => number
  createId?: () => string
}

const fingerprint = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const resolved = (stored: StoredAIProfile, source: 'fresh' | 'generated' | 'stale', errorCode: string | null = null): ResolvedAIProfile => ({ profileId: stored.profileId, profile: stored.profile, source, errorCode })

export class AIProfileAnalyzer {
  private pending: Promise<ResolvedAIProfile> | null = null
  private readonly now: () => number
  private readonly createId: () => string

  constructor(private readonly options: AIProfileAnalyzerOptions) {
    this.now = options.now ?? Date.now
    this.createId = options.createId ?? randomUUID
  }

  async currentOrRefresh(options: { force?: boolean } = {}): Promise<ResolvedAIProfile> {
    const config = this.options.getConfiguration()
    if (!config.enabled) return { profileId: null, profile: null, source: 'local', errorCode: null }
    if (!config.configured) return { profileId: null, profile: null, source: 'local', errorCode: 'AI_NOT_CONFIGURED' }
    const now = this.now()
    const fresh = this.options.repository.latest({ provider: config.provider, model: config.model, promptVersion: radioPolicy.promptVersion, minimumGeneratedAt: now - radioPolicy.profileFreshMs })
    if (!options.force && fresh != null && this.options.repository.endedPlaybackCountSince(fresh.inputHistoryCutoff) < radioPolicy.profilePlaybackThreshold) return resolved(fresh, 'fresh')
    if (this.pending != null) return await this.pending
    this.pending = this.generate(config).finally(() => { this.pending = null })
    return await this.pending
  }

  current(): ResolvedAIProfile {
    const config = this.options.getConfiguration()
    if (!config.enabled || !config.configured) return { profileId: null, profile: null, source: 'local', errorCode: config.enabled ? 'AI_NOT_CONFIGURED' : null }
    const now = this.now()
    const stored = this.options.repository.latest({ provider: config.provider, model: config.model, promptVersion: radioPolicy.promptVersion, minimumGeneratedAt: now - radioPolicy.profileFallbackMs })
    return stored == null ? { profileId: null, profile: null, source: 'local', errorCode: this.options.repository.latestRun('profile')?.errorCode ?? null } : resolved(stored, stored.expiresAt >= now ? 'fresh' : 'stale', this.options.repository.latestRun('profile')?.errorCode ?? null)
  }

  private async generate(config: AIAnalyzerConfiguration): Promise<ResolvedAIProfile> {
    const startedAt = this.now()
    const input = this.options.buildInput()
    const inputFingerprint = fingerprint(input)
    const runId = this.createId()
    try {
      const profile = await this.options.provider.analyzeProfile(input)
      const finishedAt = this.now()
      const stored: StoredAIProfile = {
        profileId: this.createId(),
        generatedAt: finishedAt,
        expiresAt: finishedAt + radioPolicy.profileFreshMs,
        provider: config.provider,
        model: config.model,
        promptVersion: radioPolicy.promptVersion,
        inputHistoryCutoff: finishedAt,
        inputFingerprint,
        profile,
      }
      getSafe(() => { this.options.repository.saveComplete(stored) })
      this.options.repository.recordRun({ runId, purpose: 'profile', startedAt, finishedAt, provider: config.provider, model: config.model, inputFingerprint, candidateCount: 0, status: 'complete', errorCode: null })
      return resolved(stored, 'generated')
    } catch (error) {
      const finishedAt = this.now()
      const code = aiErrorCode(error)
      this.options.repository.recordRun({ runId, purpose: 'profile', startedAt, finishedAt, provider: config.provider, model: config.model, inputFingerprint, candidateCount: 0, status: 'failed', errorCode: code })
      const fallback = this.options.repository.latest({ provider: config.provider, model: config.model, promptVersion: radioPolicy.promptVersion, minimumGeneratedAt: finishedAt - radioPolicy.profileFallbackMs })
      return fallback == null ? { profileId: null, profile: null, source: 'local', errorCode: code } : resolved(fallback, 'stale', code)
    }
  }
}

const getSafe = (operation: () => void): void => { operation() }
