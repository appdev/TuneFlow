import type { PlaybackLyrics } from '../playback/bundleResolver'
import type { MediaClient } from '../playback/mediaClient'
import type { SourcesService } from '../routes/sources'
import { canonicalPictureUrl, normalizeMusicInfo, toSourceMusicInfo } from '../sources/musicInfo'
import { SourceServiceError, type SourceAction, type SourceAttempt, type SourceCandidate } from '../sources/types'
import { boundedResourceAlternatives, providerTrackIdentity, type ResourceAlternative } from './alternativeCandidates'

const DEFAULT_TTL_MS = 5 * 60 * 1000
const DEFAULT_MAX_ENTRIES = 256
const DEFAULT_MAX_BYTES = 32 * 1024 * 1024
const MAX_LYRIC_FIELD_LENGTH = 1024 * 1024
const MAX_LYRICS_LENGTH = 2 * 1024 * 1024
const DEFAULT_LOOKUP_TIMEOUT_MS = 30_000

export interface TrackResourceIdentity { source: string, trackId: string }
export interface ValidatedPicture { bytes: Uint8Array, mimeType: string }
export interface ValidatedTrackResources { lyrics?: PlaybackLyrics, picture?: ValidatedPicture }
export interface TrackResourcesAvailable {
  identity: TrackResourceIdentity
  musicInfo: unknown
  resources: ValidatedTrackResources
}

interface CacheEntry {
  resources: ValidatedTrackResources
  createdAt: number
  expiresAt: number
  byteLength: number
}

interface TrackResourceCacheOptions {
  now?: () => number
  ttlMs?: number
  maxEntries?: number
  maxBytes?: number
}

const copyLyrics = (value: PlaybackLyrics): PlaybackLyrics => ({
  lyric: value.lyric,
  ...(value.tlyric === undefined ? {} : { tlyric: value.tlyric }),
  ...(value.rlyric === undefined ? {} : { rlyric: value.rlyric }),
  ...(value.verbatimLyric === undefined ? {} : { verbatimLyric: value.verbatimLyric }),
})

const copyResources = (value: ValidatedTrackResources): ValidatedTrackResources => ({
  ...(value.lyrics == null ? {} : { lyrics: copyLyrics(value.lyrics) }),
  ...(value.picture == null ? {} : { picture: { bytes: Uint8Array.from(value.picture.bytes), mimeType: value.picture.mimeType } }),
})

const resourceBytes = (value: ValidatedTrackResources): number => {
  const lyricBytes = value.lyrics == null
    ? 0
    : ['lyric', 'tlyric', 'rlyric', 'verbatimLyric'].reduce((total, field) => {
        const text = value.lyrics?.[field as keyof PlaybackLyrics]
        return total + (typeof text === 'string' ? Buffer.byteLength(text) : 0)
      }, 0)
  return lyricBytes + (value.picture?.bytes.byteLength ?? 0)
}

const cacheKey = (identity: TrackResourceIdentity): string => `${identity.source}\0${identity.trackId}`

export class TrackResourceCache {
  private readonly entries = new Map<string, CacheEntry>()
  private readonly now: () => number
  private readonly ttlMs: number
  private readonly maxEntries: number
  private readonly maxBytes: number
  private totalBytes = 0

  constructor(options: TrackResourceCacheOptions = {}) {
    this.now = options.now ?? Date.now
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  }

  get(identity: TrackResourceIdentity): ValidatedTrackResources | undefined {
    const key = cacheKey(identity)
    const entry = this.entries.get(key)
    if (entry == null) return undefined
    if (entry.expiresAt <= this.now()) {
      this.remove(key, entry)
      return undefined
    }
    return copyResources(entry.resources)
  }

  merge(identity: TrackResourceIdentity, resources: ValidatedTrackResources): ValidatedTrackResources {
    this.pruneExpired()
    const key = cacheKey(identity)
    const current = this.entries.get(key)
    if (current != null) this.remove(key, current)
    const merged = copyResources({
      ...(current?.resources ?? {}),
      ...resources,
    })
    const createdAt = this.now()
    const entry = { resources: merged, createdAt, expiresAt: createdAt + this.ttlMs, byteLength: resourceBytes(merged) }
    this.entries.set(key, entry)
    this.totalBytes += entry.byteLength
    this.pruneCapacity()
    return copyResources(merged)
  }

  private pruneExpired(): void {
    const now = this.now()
    for (const [key, entry] of this.entries) if (entry.expiresAt <= now) this.remove(key, entry)
  }

  private pruneCapacity(): void {
    while (this.entries.size > this.maxEntries || this.totalBytes > this.maxBytes) {
      const oldest = [...this.entries.entries()].sort(([, left], [, right]) => left.createdAt - right.createdAt)[0]
      if (oldest == null) return
      this.remove(oldest[0], oldest[1])
    }
  }

  private remove(key: string, entry: CacheEntry): void {
    if (!this.entries.delete(key)) return
    this.totalBytes -= entry.byteLength
  }
}

export const trackResourceIdentity = (source: string, musicInfo: unknown): TrackResourceIdentity => {
  const info = normalizeMusicInfo(musicInfo) as Record<string, unknown>
  const raw = providerTrackIdentity(info)
  if (raw == null) throw new SourceServiceError('SOURCE_PROTOCOL_ERROR', 'Track identity is missing', 'protocol')
  return { source, trackId: String(raw) }
}

const validateLyrics = (input: unknown): PlaybackLyrics => {
  if (typeof input !== 'object' || input == null) throw new SourceServiceError('SOURCE_PROTOCOL_ERROR', 'Lyrics response is invalid', 'protocol')
  const value = input as Record<string, unknown>
  const output: Record<string, string | null> = {}
  let total = 0
  for (const field of ['lyric', 'tlyric', 'rlyric', 'verbatimLyric']) {
    const text = value[field]
    if (text == null && field !== 'lyric') continue
    if (typeof text !== 'string' || text.length > MAX_LYRIC_FIELD_LENGTH || text.includes('\uFFFD')) {
      throw new SourceServiceError('SOURCE_PROTOCOL_ERROR', 'Lyrics response is invalid', 'protocol')
    }
    total += text.length
    output[field] = text
  }
  if (typeof output.lyric !== 'string' || output.lyric.trim() === '' || total > MAX_LYRICS_LENGTH) {
    throw new SourceServiceError('SOURCE_PROTOCOL_ERROR', 'Lyrics response is invalid', 'protocol')
  }
  return output as unknown as PlaybackLyrics
}

const safeAttempt = (candidate: SourceCandidate, action: SourceAction, error: unknown): SourceAttempt => ({
  sourceId: candidate.id,
  action,
  code: error instanceof SourceServiceError ? error.code : 'SOURCE_PROTOCOL_ERROR',
  elapsedMs: 0,
})

const terminal = (error: unknown): boolean => error instanceof SourceServiceError && (error.origin === 'caller' || error.origin === 'safety')

const cancelled = (): SourceServiceError => new SourceServiceError('SOURCE_CANCELLED', 'Track resource request cancelled', 'caller')

const throwIfCancelled = (signal?: AbortSignal): void => {
  if (signal?.aborted === true) throw cancelled()
}

const cancellable = async<T>(factory: () => Promise<T>, signal?: AbortSignal): Promise<T> => {
  throwIfCancelled(signal)
  if (signal == null) return await factory()
  return await new Promise<T>((resolve, reject) => {
    let settled = false
    const finish = (callback: () => void): void => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      callback()
    }
    const onAbort = (): void => { finish(() => { reject(cancelled()) }) }
    signal.addEventListener('abort', onAbort, { once: true })
    void factory().then(value => { finish(() => { resolve(value) }) }, error => { finish(() => { reject(error) }) })
  })
}

export interface TrackResourceServiceOptions {
  sources: Pick<SourcesService, 'snapshot' | 'requestSource'>
  mediaClient: Pick<MediaClient, 'fetchArtwork'>
  cache?: TrackResourceCache
  readLocal?: (musicInfo: unknown) => Promise<ValidatedTrackResources | undefined>
  findAlternatives?: (musicInfo: unknown) => Promise<Array<Record<string, unknown>>>
  getBuiltinLyrics?: (source: string, musicInfo: unknown) => Promise<PlaybackLyrics | undefined>
  getBuiltinPicture?: (source: string, musicInfo: unknown) => Promise<string | undefined>
  lookupTimeoutMs?: number
}

export class TrackResourceService {
  private readonly cache: TrackResourceCache
  private readonly listeners = new Set<(event: TrackResourcesAvailable) => void>()
  private readonly pendingLyrics = new Map<string, Promise<PlaybackLyrics>>()
  private readonly pendingPictures = new Map<string, Promise<ValidatedPicture>>()
  private readonly lookupTimeoutMs: number

  constructor(private readonly options: TrackResourceServiceOptions) {
    this.cache = options.cache ?? new TrackResourceCache()
    this.lookupTimeoutMs = options.lookupTimeoutMs ?? DEFAULT_LOOKUP_TIMEOUT_MS
  }

  subscribe(listener: (event: TrackResourcesAvailable) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  cached(identity: TrackResourceIdentity): ValidatedTrackResources | undefined { return this.cache.get(identity) }

  remember(source: string, musicInfo: unknown, resources: ValidatedTrackResources): void {
    const identity = trackResourceIdentity(source, musicInfo)
    const accepted: ValidatedTrackResources = {
      ...(resources.lyrics == null ? {} : { lyrics: validateLyrics(resources.lyrics) }),
      ...(resources.picture == null ? {} : { picture: { bytes: Uint8Array.from(resources.picture.bytes), mimeType: resources.picture.mimeType } }),
    }
    if (accepted.lyrics == null && accepted.picture == null) return
    const cached = this.cache.merge(identity, accepted)
    const event = { identity, musicInfo: normalizeMusicInfo(musicInfo), resources: cached }
    for (const listener of this.listeners) listener(event)
  }

  async resolveLyrics(source: string, musicInfo: unknown, signal?: AbortSignal): Promise<PlaybackLyrics> {
    throwIfCancelled(signal)
    const normalized = normalizeMusicInfo(musicInfo)
    const identity = trackResourceIdentity(source, normalized)
    const key = cacheKey(identity)
    const existing = this.pendingLyrics.get(key)
    if (existing != null) return await cancellable(async() => await existing, signal)
    const operation = this.withLookupTimeout(async lookupSignal => await this.lookupLyrics(source, normalized, lookupSignal)).finally(() => {
      if (this.pendingLyrics.get(key) === operation) this.pendingLyrics.delete(key)
    })
    this.pendingLyrics.set(key, operation)
    return await cancellable(async() => await operation, signal)
  }

  private async lookupLyrics(source: string, normalized: unknown, signal: AbortSignal): Promise<PlaybackLyrics> {
    const identity = trackResourceIdentity(source, normalized)
    const local = this.options.readLocal == null ? undefined : await cancellable(async() => await this.options.readLocal!(normalized), signal)
    if (local?.lyrics != null) return validateLyrics(local.lyrics)
    const cached = this.cache.get(identity)?.lyrics
    if (cached != null) return cached
    const lyrics = await this.resolveCandidateLyrics(source, normalized, signal)
    if (lyrics != null) {
      this.remember(source, normalized, { lyrics })
      return lyrics
    }
    for (const alternative of await this.alternatives(source, normalized, signal)) {
      const alternativeLyrics = await this.resolveCandidateLyrics(alternative.source, normalizeMusicInfo(alternative), signal)
      if (alternativeLyrics == null) continue
      this.remember(source, normalized, { lyrics: alternativeLyrics })
      return alternativeLyrics
    }
    throw new SourceServiceError('SOURCE_ALL_UNAVAILABLE', 'All lyric sources are unavailable', 'service-network')
  }

  private async resolveCandidateLyrics(source: string, musicInfo: unknown, signal?: AbortSignal): Promise<PlaybackLyrics | undefined> {
    const attempts: SourceAttempt[] = []
    for (const candidate of this.options.sources.snapshot(source, 'lyric')) {
      if (signal?.aborted === true) throw new SourceServiceError('SOURCE_CANCELLED', 'Lyrics request cancelled', 'caller')
      try {
        const lyrics = validateLyrics(await cancellable(async() => await this.options.sources.requestSource(candidate.id, {
          source,
          action: 'lyric',
          info: toSourceMusicInfo(musicInfo),
        }, signal), signal))
        return lyrics
      } catch (error) {
        if (terminal(error)) throw error
        attempts.push(safeAttempt(candidate, 'lyric', error))
      }
    }
    try {
      return validateLyrics(this.options.getBuiltinLyrics == null
        ? undefined
        : await cancellable(async() => await this.options.getBuiltinLyrics!(source, musicInfo), signal))
    } catch (error) {
      if (terminal(error)) throw error
      return undefined
    }
  }

  async resolvePicture(source: string, musicInfo: unknown, signal?: AbortSignal): Promise<ValidatedPicture> {
    throwIfCancelled(signal)
    const normalized = normalizeMusicInfo(musicInfo)
    const identity = trackResourceIdentity(source, normalized)
    const key = cacheKey(identity)
    const existing = this.pendingPictures.get(key)
    if (existing != null) return await cancellable(async() => await existing, signal)
    const operation = this.withLookupTimeout(async lookupSignal => await this.lookupPicture(source, normalized, lookupSignal)).finally(() => {
      if (this.pendingPictures.get(key) === operation) this.pendingPictures.delete(key)
    })
    this.pendingPictures.set(key, operation)
    return await cancellable(async() => await operation, signal)
  }

  private async lookupPicture(source: string, normalized: unknown, signal: AbortSignal): Promise<ValidatedPicture> {
    const identity = trackResourceIdentity(source, normalized)
    const local = this.options.readLocal == null ? undefined : await cancellable(async() => await this.options.readLocal!(normalized), signal)
    if (local?.picture != null) return copyResources({ picture: local.picture }).picture!
    const cached = this.cache.get(identity)?.picture
    if (cached != null) return cached
    const picture = await this.resolveCandidatePicture(source, normalized, signal)
    if (picture != null) {
      this.remember(source, normalized, { picture })
      return picture
    }
    for (const alternative of await this.alternatives(source, normalized, signal)) {
      const alternativePicture = await this.resolveCandidatePicture(alternative.source, normalizeMusicInfo(alternative), signal)
      if (alternativePicture == null) continue
      this.remember(source, normalized, { picture: alternativePicture })
      return alternativePicture
    }
    throw new SourceServiceError('SOURCE_ALL_UNAVAILABLE', 'All picture sources are unavailable', 'service-network')
  }

  private async resolveCandidatePicture(source: string, musicInfo: unknown, signal?: AbortSignal): Promise<ValidatedPicture | undefined> {
    const attempts: SourceAttempt[] = []
    const read = async(url: string): Promise<ValidatedPicture> => {
      const picture = await cancellable(async() => await this.options.mediaClient.fetchArtwork({ url }, signal), signal)
      return { bytes: Uint8Array.from(picture.bytes), mimeType: picture.mimeType }
    }
    for (const candidate of this.options.sources.snapshot(source, 'pic')) {
      try {
        const url = await cancellable(async() => await this.options.sources.requestSource<string>(candidate.id, { source, action: 'pic', info: toSourceMusicInfo(musicInfo) }, signal), signal)
        return await read(url)
      } catch (error) {
        if (terminal(error)) throw error
        attempts.push(safeAttempt(candidate, 'pic', error))
      }
    }
    const urls = [await (this.options.getBuiltinPicture == null
      ? Promise.resolve(undefined)
      : cancellable(async() => await this.options.getBuiltinPicture!(source, musicInfo), signal)).catch(error => {
      if (terminal(error)) throw error
      return undefined
    }), canonicalPictureUrl(musicInfo)]
    for (const url of urls) {
      if (url == null) continue
      try {
        return await read(url)
      } catch (error) {
        if (terminal(error)) throw error
      }
    }
    return undefined
  }

  private async alternatives(source: string, musicInfo: unknown, signal?: AbortSignal): Promise<ResourceAlternative[]> {
    let candidates: Array<Record<string, unknown>>
    try {
      candidates = this.options.findAlternatives == null
        ? []
        : await cancellable(async() => await this.options.findAlternatives!(musicInfo), signal)
    } catch (error) {
      if (terminal(error)) throw error
      return []
    }
    return boundedResourceAlternatives(source, candidates)
  }

  private async withLookupTimeout<T>(factory: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const signal = AbortSignal.timeout(this.lookupTimeoutMs)
    try {
      return await factory(signal)
    } catch (error) {
      if (signal.aborted) {
        throw new SourceServiceError('SOURCE_ALL_UNAVAILABLE', 'Track resource lookup timed out', 'service-network')
      }
      throw error
    }
  }
}
