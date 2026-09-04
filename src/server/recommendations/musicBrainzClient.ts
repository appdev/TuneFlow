import { setTimeout as delay } from 'node:timers/promises'
import { normalizeMusicBrainzBaseUrl, OFFICIAL_MUSICBRAINZ_BASE_URL } from './musicBrainzEndpoint'

export type MusicBrainzErrorCode =
  | 'invalid_url'
  | 'timeout'
  | 'response_too_large'
  | 'cross_origin_redirect'
  | 'invalid_response'
  | 'rate_limited'
  | 'unreachable'

export class MusicBrainzClientError extends Error {
  constructor(
    readonly code: MusicBrainzErrorCode,
    readonly retryable = false,
    readonly retryAfterMs: number | null = null,
  ) {
    super(code)
    this.name = 'MusicBrainzClientError'
  }
}

export interface MusicBrainzRequestOptions {
  signal?: AbortSignal
}

export interface MusicBrainzClientOptions {
  fetch?: typeof globalThis.fetch
  now?: () => number
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>
  timeoutMs?: number
  maxResponseBytes?: number
  maxRedirects?: number
  userAgent?: string
  retryDelaysMs?: readonly number[]
}

const OFFICIAL_REQUEST_INTERVAL_MS = 1_100
const DEFAULT_RETRY_DELAYS_MS = Object.freeze([2_000, 5_000])
const RETRYABLE_STATUS_CODES = new Set([502, 503, 504])

const isJsonResponse = (response: Response): boolean => {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
  return contentType.includes('application/json') || contentType.includes('+json')
}

export class MusicBrainzClient {
  readonly baseUrl: string
  private readonly fetchImpl: typeof globalThis.fetch
  private readonly now: () => number
  private readonly sleep: (milliseconds: number) => Promise<void>
  private readonly timeoutMs: number
  private readonly maxResponseBytes: number
  private readonly maxRedirects: number
  private readonly userAgent: string
  private readonly retryDelaysMs: readonly number[]
  private lastOfficialRequestAt = Number.NEGATIVE_INFINITY
  private officialRequestQueue: Promise<void> = Promise.resolve()

  constructor(baseUrl: string, options: MusicBrainzClientOptions = {}) {
    try {
      this.baseUrl = normalizeMusicBrainzBaseUrl(baseUrl)
    } catch {
      throw new MusicBrainzClientError('invalid_url')
    }
    this.fetchImpl = options.fetch ?? globalThis.fetch
    this.now = options.now ?? Date.now
    this.sleep = options.sleep ?? (async(milliseconds, signal) => { await delay(milliseconds, undefined, { signal }) })
    this.timeoutMs = options.timeoutMs ?? 10_000
    this.maxResponseBytes = options.maxResponseBytes ?? 2 * 1024 * 1024
    this.maxRedirects = options.maxRedirects ?? 2
    this.userAgent = options.userAgent ?? 'TuneFlow-Service/1.0 (MusicBrainz metadata client)'
    this.retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS
  }

  async getJson(path: string, options: MusicBrainzRequestOptions = {}): Promise<unknown> {
    let target: URL
    try {
      target = new URL(path, this.baseUrl)
    } catch {
      throw new MusicBrainzClientError('invalid_url')
    }
    if (target.origin !== new URL(this.baseUrl).origin) throw new MusicBrainzClientError('cross_origin_redirect')

    const execute = async(): Promise<unknown> => await this.getJsonWithRetries(target, options.signal)
    if (target.origin !== new URL(OFFICIAL_MUSICBRAINZ_BASE_URL).origin) return await execute()
    const queued = this.officialRequestQueue.then(execute, execute)
    this.officialRequestQueue = queued.then(() => {}, () => {})
    return await queued
  }

  private async getJsonWithRetries(target: URL, signal?: AbortSignal): Promise<unknown> {
    for (let attempt = 0; ; attempt += 1) {
      this.throwIfAborted(signal)
      try {
        return await this.requestJson(target, signal)
      } catch (error) {
        if (!(error instanceof MusicBrainzClientError) || !error.retryable || attempt >= this.retryDelaysMs.length) throw error
        await this.wait(Math.max(this.retryDelaysMs[attempt], error.retryAfterMs ?? 0), signal)
      }
    }
  }

  private async requestJson(initialTarget: URL, externalSignal?: AbortSignal): Promise<unknown> {
    let target = initialTarget
    const controller = new AbortController()
    const abort = (): void => { controller.abort() }
    if (externalSignal?.aborted === true) throw new MusicBrainzClientError('timeout')
    externalSignal?.addEventListener('abort', abort, { once: true })
    const timeout = setTimeout(() => { controller.abort() }, this.timeoutMs)
    try {
      for (let redirectCount = 0; redirectCount <= this.maxRedirects; redirectCount += 1) {
        await this.waitForOfficialRateLimit(target, controller.signal)
        let response: Response
        try {
          response = await this.fetchImpl(target, {
            headers: { accept: 'application/json', 'user-agent': this.userAgent },
            redirect: 'manual',
            signal: controller.signal,
          })
        } catch (error) {
          if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
            throw new MusicBrainzClientError('timeout')
          }
          throw new MusicBrainzClientError('unreachable', true)
        }

        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location')
          if (location == null || redirectCount === this.maxRedirects) throw new MusicBrainzClientError('invalid_response')
          const redirected = new URL(location, target)
          if (redirected.origin !== target.origin) throw new MusicBrainzClientError('cross_origin_redirect')
          target = redirected
          continue
        }
        if (response.status === 429) throw new MusicBrainzClientError('rate_limited', true, this.retryAfterMs(response))
        if (RETRYABLE_STATUS_CODES.has(response.status)) throw new MusicBrainzClientError('unreachable', true, this.retryAfterMs(response))
        if (!response.ok) throw new MusicBrainzClientError('unreachable')
        if (!isJsonResponse(response)) throw new MusicBrainzClientError('invalid_response')
        const declaredLength = Number(response.headers.get('content-length') ?? 0)
        if (declaredLength > this.maxResponseBytes) throw new MusicBrainzClientError('response_too_large')
        let bytes: Uint8Array
        try {
          bytes = await this.readBounded(response)
        } catch (error) {
          if (controller.signal.aborted) throw new MusicBrainzClientError('timeout')
          throw error
        }
        try {
          return JSON.parse(new TextDecoder().decode(bytes)) as unknown
        } catch {
          throw new MusicBrainzClientError('invalid_response')
        }
      }
    } finally {
      clearTimeout(timeout)
      externalSignal?.removeEventListener('abort', abort)
    }
    throw new MusicBrainzClientError('invalid_response')
  }

  private async readBounded(response: Response): Promise<Uint8Array> {
    if (response.body == null) return new Uint8Array()
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let length = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > this.maxResponseBytes) {
        await reader.cancel()
        throw new MusicBrainzClientError('response_too_large')
      }
      chunks.push(value)
    }
    const result = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) {
      result.set(chunk, offset)
      offset += chunk.byteLength
    }
    return result
  }

  private async waitForOfficialRateLimit(target: URL, signal?: AbortSignal): Promise<void> {
    if (target.origin !== new URL(OFFICIAL_MUSICBRAINZ_BASE_URL).origin) return
    const wait = Math.max(0, OFFICIAL_REQUEST_INTERVAL_MS - (this.now() - this.lastOfficialRequestAt))
    if (wait > 0) await this.wait(wait, signal)
    this.lastOfficialRequestAt = this.now()
  }

  private async wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
    this.throwIfAborted(signal)
    try {
      await this.sleep(milliseconds, signal)
    } catch (error) {
      if (signal?.aborted === true || (error instanceof Error && error.name === 'AbortError')) throw new MusicBrainzClientError('timeout')
      throw error
    }
    this.throwIfAborted(signal)
  }

  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted === true) throw new MusicBrainzClientError('timeout')
  }

  private retryAfterMs(response: Response): number | null {
    const value = response.headers.get('retry-after')
    if (value == null) return null
    const seconds = Number(value)
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000
    const date = Date.parse(value)
    return Number.isFinite(date) ? Math.max(0, date - this.now()) : null
  }
}
