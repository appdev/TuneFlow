import type { SourcesService } from '../routes/sources'
import { randomUUID } from 'node:crypto'
import { ApiError } from '../errors'
import { SourceServiceError, type SourceAction, type SourceAttempt, type SourceAttemptLog, type SourceCandidate } from '../sources/types'
import { toSourceMusicUrlInfo } from '../sources/musicInfo'
import type { MediaClient, MediaTarget } from './mediaClient'
import type { PlaybackResourceStore } from './resourceStore'

export const BUNDLE_ENRICHMENT_BUDGET_MS = 4_000
export const BUNDLE_HEDGE_DELAY_MS = 500

export type BundleCompleteness = 'complete' | 'mixed' | 'audio-only'
export interface StreamCandidate { sourceId: string, url: string, headers?: Record<string, string> }
export interface PlaybackLyrics { lyric: string, tlyric?: string | null, rlyric?: string | null, verbatimLyric?: string | null }
export interface PlaybackResources { lyrics?: PlaybackLyrics, lyricsUrl?: string, pictureUrl?: string }
export interface PlaybackBundle {
  audioKind: 'local' | 'online'
  streamUrl?: string
  streamCandidates: StreamCandidate[]
  resources: PlaybackResources
  completeness: BundleCompleteness
  sourceIds: { audio: string, lyrics?: string, picture?: string }
}
export interface LocalPlaybackMatch { streamUrl: string, pictureUrl?: string, lyricsUrl?: string }

interface EvaluatedSource {
  candidate: SourceCandidate
  audio?: StreamCandidate
  lyrics?: PlaybackLyrics
  pictureUrl?: string
}

export interface PlaybackBundleResolverOptions {
  sources: SourcesService
  mediaClient: MediaClient
  resourceStore: PlaybackResourceStore
  findLocal?: (musicInfo: unknown) => Promise<LocalPlaybackMatch | undefined> | LocalPlaybackMatch | undefined
  findAlternatives?: (musicInfo: unknown) => Promise<Array<Record<string, unknown>>>
  getBuiltinLyrics?: (provider: string, musicInfo: unknown) => Promise<PlaybackLyrics | undefined>
  getBuiltinPicture?: (provider: string, musicInfo: unknown) => Promise<string | undefined>
  budgetMs?: number
  hedgeDelayMs?: number
  onAttempt?: (attempt: SourceAttemptLog) => void
}

const originalMusicInfo = (info: unknown): unknown => typeof info === 'object' && info != null && 'musicInfo' in info
  ? (info as { musicInfo: unknown }).musicInfo
  : info

const isRetryableResourceFailure = (error: unknown): boolean => {
  return error instanceof SourceServiceError && (error.origin === 'service-network' || error.origin === 'worker-timeout')
}

const beforeDeadline = async<T>(factory: (signal: AbortSignal) => Promise<T>, deadline: number, callerSignal?: AbortSignal): Promise<T | undefined> => {
  if (callerSignal?.aborted === true) throw new SourceServiceError('SOURCE_CANCELLED', 'Playback request cancelled', 'caller')
  const remaining = Math.max(0, deadline - Date.now())
  if (remaining === 0) return undefined
  const controller = new AbortController()
  const signal = callerSignal == null ? controller.signal : AbortSignal.any([callerSignal, controller.signal])
  return await new Promise<T | undefined>((resolve, reject) => {
    let finished = false
    const finish = (callback: () => void): void => {
      if (finished) return
      finished = true
      clearTimeout(timeout)
      callerSignal?.removeEventListener('abort', onAbort)
      callback()
    }
    const onAbort = (): void => { finish(() => { reject(new SourceServiceError('SOURCE_CANCELLED', 'Playback request cancelled', 'caller')) }) }
    const timeout = setTimeout(() => {
      controller.abort()
      finish(() => { resolve(undefined) })
    }, remaining)
    callerSignal?.addEventListener('abort', onAbort, { once: true })
    void factory(signal).then(value => { finish(() => { resolve(value) }) }, error => {
      if (controller.signal.aborted && callerSignal?.aborted !== true) finish(() => { resolve(undefined) })
      else finish(() => { reject(error) })
    })
  })
}

export class PlaybackBundleResolver {
  constructor(private readonly options: PlaybackBundleResolverOptions) {}

  async resolve(input: { source: string, info: unknown, quality: TuneFlow.Quality, preferLocal?: boolean }, signal?: AbortSignal): Promise<PlaybackBundle> {
    const requestId = randomUUID()
    const attempts: SourceAttempt[] = []
    const enrichmentDeadline = Date.now() + (this.options.budgetMs ?? BUNDLE_ENRICHMENT_BUDGET_MS)
    const musicInfo = originalMusicInfo(input.info)
    const local = input.preferLocal === false ? undefined : await this.options.findLocal?.(musicInfo)
    if (local != null) return await this.resolveLocal(local, input, requestId, attempts, enrichmentDeadline, signal)
    const original = await this.evaluateTrack(input.source, input.info, input.quality, requestId, attempts, enrichmentDeadline, signal)
    if (original.some(value => value.audio != null)) return await this.assembleOnline(original, input.source, musicInfo, enrichmentDeadline, signal)
    const alternatives = await this.options.findAlternatives?.(musicInfo) ?? []
    for (const alternative of alternatives) {
      if (typeof alternative.source !== 'string' || alternative.source === input.source) continue
      const evaluated = await this.evaluateTrack(alternative.source, alternative, input.quality, requestId, attempts, enrichmentDeadline, signal)
      if (evaluated.some(value => value.audio != null)) return await this.assembleOnline(evaluated, alternative.source, alternative, enrichmentDeadline, signal)
    }
    throw new ApiError(502, 'SOURCE_ALL_UNAVAILABLE', 'All enabled sources are unavailable', { attempts })
  }

  private async resolveLocal(local: LocalPlaybackMatch, input: { source: string, info: unknown, quality: TuneFlow.Quality }, requestId: string, attempts: SourceAttempt[], enrichmentDeadline: number, signal?: AbortSignal): Promise<PlaybackBundle> {
    const resources: PlaybackResources = {
      ...(local.lyricsUrl == null ? {} : { lyricsUrl: local.lyricsUrl }),
      ...(local.pictureUrl == null ? {} : { pictureUrl: local.pictureUrl }),
    }
    const sourceIds: PlaybackBundle['sourceIds'] = {
      audio: 'local',
      ...(local.lyricsUrl == null ? {} : { lyrics: 'local' }),
      ...(local.pictureUrl == null ? {} : { picture: 'local' }),
    }
    if (local.lyricsUrl == null || local.pictureUrl == null) {
      let enrichment: Awaited<ReturnType<PlaybackBundleResolver['bestResources']>> = {}
      try {
        const wanted = new Set<SourceAction>([
          ...(local.lyricsUrl == null ? ['lyric' as const] : []),
          ...(local.pictureUrl == null ? ['pic' as const] : []),
        ])
        const evaluated = await this.evaluateTrack(input.source, input.info, input.quality, requestId, attempts, enrichmentDeadline, signal, false, wanted)
        enrichment = await this.bestResources(evaluated, input.source, originalMusicInfo(input.info), enrichmentDeadline, signal, wanted)
      } catch (error) {
        if (signal?.aborted === true) throw error
        // Optional enrichment must never make local audio unavailable.
      }
      if (local.lyricsUrl == null && enrichment.lyrics != null) {
        resources.lyrics = enrichment.lyrics.value
        sourceIds.lyrics = enrichment.lyrics.sourceId
      }
      if (local.pictureUrl == null && enrichment.picture != null) {
        resources.pictureUrl = enrichment.picture.value
        sourceIds.picture = enrichment.picture.sourceId
      }
    }
    const hasLyrics = resources.lyrics != null || resources.lyricsUrl != null
    const hasPicture = resources.pictureUrl != null
    const allLocal = sourceIds.lyrics === 'local' && sourceIds.picture === 'local'
    return {
      audioKind: 'local',
      streamUrl: local.streamUrl,
      streamCandidates: [],
      resources,
      completeness: hasLyrics && hasPicture ? allLocal ? 'complete' : 'mixed' : hasLyrics || hasPicture ? 'mixed' : 'audio-only',
      sourceIds,
    }
  }

  private async evaluateTrack(provider: string, info: unknown, quality: TuneFlow.Quality, requestId: string, attempts: SourceAttempt[], enrichmentDeadline: number, signal?: AbortSignal, includeAudio = true, wantedResources = new Set<SourceAction>(['lyric', 'pic'])): Promise<EvaluatedSource[]> {
    const actions: SourceAction[] = [...(includeAudio ? ['musicUrl' as const] : []), ...wantedResources]
    const byId = new Map<string, SourceCandidate>()
    const actionsById = new Map<string, Set<SourceAction>>()
    for (const action of actions) {
      for (const candidate of this.options.sources.snapshot(provider, action)) {
        byId.set(candidate.id, candidate)
        const supported = actionsById.get(candidate.id) ?? new Set<SourceAction>()
        supported.add(action)
        actionsById.set(candidate.id, supported)
      }
    }
    const candidates = [...byId.values()].sort((a, b) => a.priority - b.priority)
    const enrichmentController = new AbortController()
    const audioController = new AbortController()
    const enrichmentSignal = signal == null ? enrichmentController.signal : AbortSignal.any([signal, enrichmentController.signal])
    const audioSignal = signal == null ? audioController.signal : AbortSignal.any([signal, audioController.signal])
    const values = new Array<EvaluatedSource | undefined>(candidates.length)
    const completed = new Array<boolean>(candidates.length).fill(false)
    const terminalErrors = new Array<Error | undefined>(candidates.length)
    const selectedIndex = (): number => {
      const complete = values.findIndex(value => value?.audio != null && value.lyrics != null && value.pictureUrl != null)
      return complete >= 0 ? complete : values.findIndex(value => value?.audio != null)
    }
    const precedingTerminal = (): Error | undefined => {
      const selected = selectedIndex()
      if (selected < 0) return undefined
      return terminalErrors.slice(0, selected + 1).find(error => error != null)
    }
    let decisive: (() => void) | undefined
    const decisiveResult = new Promise<'decisive'>(resolve => { decisive = () => { resolve('decisive') } })
    const maybeDecisive = (): void => {
      const index = values.findIndex(value => value?.audio != null && value.lyrics != null && value.pictureUrl != null)
      if (index >= 0 && completed.slice(0, index + 1).every(Boolean) && terminalErrors.slice(0, index + 1).every(error => error == null)) decisive?.()
    }
    const remaining = Math.max(0, enrichmentDeadline - Date.now())
    let budgetExpired: (() => void) | undefined
    const budget = new Promise<'budget'>(resolve => { budgetExpired = () => { resolve('budget') } })
    const timeout = setTimeout(() => {
      enrichmentController.abort()
      budgetExpired?.()
    }, remaining)
    try {
      const tasks = candidates.map(async(candidate, index) => {
        await this.delay(index * (this.options.hedgeDelayMs ?? BUNDLE_HEDGE_DELAY_MS), signal)
        return await this.evaluateSource(candidate, actionsById.get(candidate.id) ?? new Set(), provider, info, quality, includeAudio, wantedResources, requestId, attempts, signal, audioSignal, enrichmentSignal, value => {
          values[index] = value
          maybeDecisive()
        })
      }).map(async(task, index) => await task.then(value => {
        values[index] = value
        completed[index] = true
        maybeDecisive()
        return value
      }, error => {
        terminalErrors[index] = error instanceof Error ? error : new SourceServiceError('SOURCE_PROTOCOL_ERROR', 'Source request failed', 'protocol')
        completed[index] = true
        maybeDecisive()
        throw error
      }))
      const all = Promise.allSettled(tasks)
      const outcome = await Promise.race([all.then(() => 'all' as const), budget, decisiveResult])
      if (outcome === 'decisive' || (outcome === 'budget' && (includeAudio ? values.some(value => value?.audio != null) : true))) {
        const terminal = precedingTerminal()
        if (terminal != null) throw terminal
        audioController.abort()
        return values.flatMap(value => value == null ? [] : [value])
      }
      const settled = await all
      if (values.some(value => value?.audio != null)) {
        const terminal = precedingTerminal()
        if (terminal != null) throw terminal
        return values.flatMap(value => value == null ? [] : [value])
      }
      const rejected = settled.find((value): value is PromiseRejectedResult => value.status === 'rejected')
      if (rejected != null) throw rejected.reason
      return values.flatMap(value => value == null ? [] : [value])
    } finally {
      clearTimeout(timeout)
      enrichmentController.abort()
      audioController.abort()
    }
  }

  private async evaluateSource(candidate: SourceCandidate, supportedActions: ReadonlySet<SourceAction>, provider: string, info: unknown, quality: TuneFlow.Quality, includeAudio: boolean, wantedResources: Set<SourceAction>, requestId: string, attempts: SourceAttempt[], callerSignal: AbortSignal | undefined, audioSignal: AbortSignal, enrichmentSignal: AbortSignal, publish: (value: EvaluatedSource) => void): Promise<EvaluatedSource | undefined> {
    const startedAt = Date.now()
    const result: EvaluatedSource = { candidate }
    const can = (action: SourceAction): boolean => supportedActions.has(action)
    try {
      if (includeAudio && can('musicUrl')) {
        const value = await this.options.sources.requestSource<{ url: string, headers?: Record<string, string> }>(candidate.id, {
          source: provider,
          action: 'musicUrl',
          info: toSourceMusicUrlInfo(info, quality),
        }, audioSignal)
        const target: MediaTarget = { url: value.url, headers: value.headers }
        await this.options.mediaClient.probeAudio(target, audioSignal)
        result.audio = { sourceId: candidate.id, url: value.url, headers: value.headers }
        publish(result)
      }
      const resources = await Promise.allSettled([
        wantedResources.has('lyric') && can('lyric') ? this.readLyrics(candidate.id, provider, info, enrichmentSignal) : undefined,
        wantedResources.has('pic') && can('pic') ? this.readPicture(candidate.id, provider, info, enrichmentSignal) : undefined,
      ])
      for (const rejected of resources.filter((value): value is PromiseRejectedResult => value.status === 'rejected')) {
        if (callerSignal?.aborted === true) throw rejected.reason
      }
      if (resources[0].status === 'fulfilled') result.lyrics = resources[0].value
      if (resources[1].status === 'fulfilled') result.pictureUrl = resources[1].value
      publish(result)
      this.options.onAttempt?.({ requestId, sourceId: candidate.id, priority: candidate.priority, action: 'bundle', code: 'OK', elapsedMs: Date.now() - startedAt })
      return result
    } catch (error) {
      const code = error instanceof SourceServiceError ? error.code : 'SOURCE_PROTOCOL_ERROR'
      attempts.push({ sourceId: candidate.id, action: 'bundle', code, elapsedMs: Date.now() - startedAt })
      this.options.onAttempt?.({ requestId, sourceId: candidate.id, priority: candidate.priority, action: 'bundle', code, elapsedMs: Date.now() - startedAt })
      if (callerSignal?.aborted === true) throw error
      if (isRetryableResourceFailure(error) || audioSignal.aborted) return Object.keys(result).length > 1 ? result : undefined
      throw error
    }
  }

  private async readLyrics(sourceId: string, provider: string, info: unknown, signal: AbortSignal): Promise<PlaybackLyrics | undefined> {
    const value = await this.options.sources.requestSource<PlaybackLyrics>(sourceId, { source: provider, action: 'lyric', info }, signal)
    if (typeof value.lyric !== 'string' || value.lyric.trim() === '' || value.lyric.includes('\uFFFD')) throw new SourceServiceError('SOURCE_MEDIA_INVALID', 'Lyrics are invalid', 'protocol')
    return value
  }

  private async readPicture(sourceId: string, provider: string, info: unknown, signal: AbortSignal): Promise<string> {
    const url = await this.options.sources.requestSource<string>(sourceId, { source: provider, action: 'pic', info }, signal)
    const picture = await this.options.mediaClient.fetchArtwork({ url }, signal)
    const stored = this.options.resourceStore.putPicture(picture)
    return `/api/v1/playback/resources/${stored.token}/picture`
  }

  private async assembleOnline(evaluated: EvaluatedSource[], provider: string, info: unknown, enrichmentDeadline: number, signal?: AbortSignal): Promise<PlaybackBundle> {
    const ordered = [...evaluated].sort((a, b) => a.candidate.priority - b.candidate.priority)
    const complete = ordered.find(value => value.audio != null && value.lyrics != null && value.pictureUrl != null)
    const audio = complete?.audio ?? ordered.find(value => value.audio != null)?.audio
    if (audio == null) throw new SourceServiceError('SOURCE_ALL_UNAVAILABLE', 'No enabled source returned usable audio', 'service-network')
    const enrichment = await this.bestResources(ordered, provider, info, enrichmentDeadline, signal)
    const lyrics = complete?.lyrics == null ? enrichment.lyrics : { sourceId: complete.candidate.id, value: complete.lyrics }
    const picture = complete?.pictureUrl == null ? enrichment.picture : { sourceId: complete.candidate.id, value: complete.pictureUrl }
    const selectedId = complete?.candidate.id ?? audio.sourceId
    const streamCandidates = [
      audio,
      ...ordered.flatMap(value => value.audio == null || value.audio.sourceId === audio.sourceId ? [] : [value.audio]),
    ]
    return {
      audioKind: 'online',
      streamCandidates,
      resources: {
        ...(lyrics == null ? {} : { lyrics: lyrics.value }),
        ...(picture == null ? {} : { pictureUrl: picture.value }),
      },
      completeness: lyrics != null && picture != null ? complete == null ? 'mixed' : 'complete' : lyrics != null || picture != null ? 'mixed' : 'audio-only',
      sourceIds: {
        audio: selectedId,
        ...(lyrics == null ? {} : { lyrics: lyrics.sourceId }),
        ...(picture == null ? {} : { picture: picture.sourceId }),
      },
    }
  }

  private async bestResources(evaluated: EvaluatedSource[], provider: string, info: unknown, enrichmentDeadline: number, signal?: AbortSignal, wanted = new Set<SourceAction>(['lyric', 'pic'])): Promise<{
    lyrics?: { sourceId: string, value: PlaybackLyrics }
    picture?: { sourceId: string, value: string }
  }> {
    const ordered = [...evaluated].sort((a, b) => a.candidate.priority - b.candidate.priority)
    let lyrics = ordered.find(value => value.lyrics != null)
    let picture = ordered.find(value => value.pictureUrl != null)
    try {
      if (lyrics == null && wanted.has('lyric')) {
        const value = this.options.getBuiltinLyrics == null ? undefined : await beforeDeadline(async() => await this.options.getBuiltinLyrics!(provider, info), enrichmentDeadline, signal)
        if (value != null && value.lyric.trim() !== '') lyrics = { candidate: { id: `builtin:${provider}`, priority: Number.MAX_SAFE_INTEGER }, lyrics: value }
      }
      if (picture == null && wanted.has('pic')) {
        const url = this.options.getBuiltinPicture == null ? undefined : await beforeDeadline(async() => await this.options.getBuiltinPicture!(provider, info), enrichmentDeadline, signal)
        if (url != null) {
          const value = await beforeDeadline(async deadlineSignal => await this.options.mediaClient.fetchArtwork({ url }, deadlineSignal), enrichmentDeadline, signal)
          if (value != null) {
            const stored = this.options.resourceStore.putPicture(value)
            picture = { candidate: { id: `builtin:${provider}`, priority: Number.MAX_SAFE_INTEGER }, pictureUrl: `/api/v1/playback/resources/${stored.token}/picture` }
          }
        }
      }
    } catch (error) {
      if (signal?.aborted === true) throw error
    }
    return {
      ...(lyrics?.lyrics == null ? {} : { lyrics: { sourceId: lyrics.candidate.id, value: lyrics.lyrics } }),
      ...(picture?.pictureUrl == null ? {} : { picture: { sourceId: picture.candidate.id, value: picture.pictureUrl } }),
    }
  }

  private async delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
    if (milliseconds <= 0) return
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(resolve, milliseconds)
      const abort = () => {
        clearTimeout(timeout)
        reject(new SourceServiceError('SOURCE_CANCELLED', 'Bundle resolution cancelled', 'caller'))
      }
      signal?.addEventListener('abort', abort, { once: true })
    })
  }
}
