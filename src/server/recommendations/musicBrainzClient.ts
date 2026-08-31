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
  constructor(readonly code: MusicBrainzErrorCode) {
    super(code)
    this.name = 'MusicBrainzClientError'
  }
}

export interface MusicBrainzClientOptions {
  fetch?: typeof globalThis.fetch
  now?: () => number
  sleep?: (milliseconds: number) => Promise<void>
  timeoutMs?: number
  maxResponseBytes?: number
  maxRedirects?: number
  userAgent?: string
}

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
  private lastOfficialRequestAt = Number.NEGATIVE_INFINITY

  constructor(baseUrl: string, options: MusicBrainzClientOptions = {}) {
    try {
      this.baseUrl = normalizeMusicBrainzBaseUrl(baseUrl)
    } catch {
      throw new MusicBrainzClientError('invalid_url')
    }
    this.fetchImpl = options.fetch ?? globalThis.fetch
    this.now = options.now ?? Date.now
    this.sleep = options.sleep ?? (async milliseconds => { await delay(milliseconds) })
    this.timeoutMs = options.timeoutMs ?? 10_000
    this.maxResponseBytes = options.maxResponseBytes ?? 2 * 1024 * 1024
    this.maxRedirects = options.maxRedirects ?? 2
    this.userAgent = options.userAgent ?? 'TuneFlow-Service/1.0 (MusicBrainz metadata client)'
  }

  async getJson(path: string): Promise<unknown> {
    let target: URL
    try {
      target = new URL(path, this.baseUrl)
    } catch {
      throw new MusicBrainzClientError('invalid_url')
    }
    if (target.origin !== new URL(this.baseUrl).origin) throw new MusicBrainzClientError('cross_origin_redirect')

    const controller = new AbortController()
    const timeout = setTimeout(() => { controller.abort() }, this.timeoutMs)
    try {
      for (let redirectCount = 0; redirectCount <= this.maxRedirects; redirectCount += 1) {
        await this.waitForOfficialRateLimit(target)
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
          throw new MusicBrainzClientError('unreachable')
        }

        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location')
          if (location == null || redirectCount === this.maxRedirects) throw new MusicBrainzClientError('invalid_response')
          const redirected = new URL(location, target)
          if (redirected.origin !== target.origin) throw new MusicBrainzClientError('cross_origin_redirect')
          target = redirected
          continue
        }
        if (response.status === 429) throw new MusicBrainzClientError('rate_limited')
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

  private async waitForOfficialRateLimit(target: URL): Promise<void> {
    if (target.origin !== new URL(OFFICIAL_MUSICBRAINZ_BASE_URL).origin) return
    const wait = Math.max(0, 1_000 - (this.now() - this.lastOfficialRequestAt))
    if (wait > 0) await this.sleep(wait)
    this.lastOfficialRequestAt = this.now()
  }
}
