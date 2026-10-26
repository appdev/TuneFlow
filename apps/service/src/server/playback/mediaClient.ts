import { lookup as dnsLookup } from 'node:dns/promises'
import type { Readable } from 'node:stream'
import { Agent, request as undiciRequest, type Dispatcher } from 'undici'
import { imageSize } from 'image-size'
import { isBlockedAddress } from '../sources/network'
import { SourceServiceError } from '../sources/types'

const MAX_REDIRECTS = 5
const AUDIO_PROBE_BYTES = 64 * 1024
const MAX_ARTWORK_BYTES = 5 * 1024 * 1024

export interface MediaTarget { url: string, headers?: Record<string, string> }
export interface OpenMediaRequest { method: 'GET' | 'HEAD', range?: string, ifRange?: string, signal?: AbortSignal }
export interface OpenMediaResponse {
  statusCode: number
  headers: Record<string, string>
  body: Readable
  close: () => void
}

export interface MediaClientOptions {
  allowPrivateNetwork?: boolean
  lookup?: (hostname: string) => Promise<string[]>
  timeoutMs?: number
}

const asHeaders = (headers: Record<string, string | string[] | undefined>): Record<string, string> => {
  return Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), Array.isArray(value) ? value.join(',') : value ?? '']))
}

const closeDispatcher = (dispatcher: Dispatcher): void => { void dispatcher.close().catch(() => {}) }

const availabilityStatus = (status: number): boolean => [401, 403, 404, 408, 410, 429].includes(status) || status >= 500

export class MediaClient {
  constructor(private readonly options: MediaClientOptions = {}) {}

  async open(target: MediaTarget, request: OpenMediaRequest): Promise<OpenMediaResponse> {
    let current: URL
    try { current = new URL(target.url) } catch { throw new SourceServiceError('SOURCE_PROTOCOL_ERROR', 'Invalid media target', 'protocol') }
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
      if (current.protocol !== 'http:' && current.protocol !== 'https:') throw new SourceServiceError('SOURCE_TARGET_BLOCKED', 'Media target is not allowed', 'safety')
      let addresses: string[]
      try {
        addresses = this.options.lookup == null
          ? (await dnsLookup(current.hostname, { all: true, verbatim: true })).map(value => value.address)
          : await this.options.lookup(current.hostname)
      } catch (error) {
        if (error instanceof SourceServiceError) throw error
        throw new SourceServiceError('SOURCE_NETWORK_ERROR', 'Media target lookup failed', 'service-network')
      }
      if (addresses.length === 0) throw new SourceServiceError('SOURCE_NETWORK_ERROR', 'Media target lookup failed', 'service-network')
      if (this.options.allowPrivateNetwork !== true && addresses.some(isBlockedAddress)) throw new SourceServiceError('SOURCE_TARGET_BLOCKED', 'Media target is not allowed', 'safety')
      const dispatcher = new Agent({
        connect: {
          lookup: (_hostname, lookupOptions, callback) => {
            const resolved = addresses.map(address => ({ address, family: address.includes(':') ? 6 : 4 }))
            if (lookupOptions.all) callback(null, resolved)
            else callback(null, resolved[0].address, resolved[0].family)
          },
        },
      })
      try {
        const response = await undiciRequest(current, {
          method: request.method,
          headers: {
            ...(target.headers ?? {}),
            ...(request.range == null ? {} : { range: request.range }),
            ...(request.ifRange == null ? {} : { 'if-range': request.ifRange }),
          },
          dispatcher,
          signal: request.signal,
          maxRedirections: 0,
          headersTimeout: this.options.timeoutMs ?? 15_000,
          bodyTimeout: this.options.timeoutMs ?? 15_000,
        })
        const headers = asHeaders(response.headers as Record<string, string | string[] | undefined>)
        if (response.statusCode >= 300 && response.statusCode < 400 && headers.location != null) {
          await response.body.dump()
          closeDispatcher(dispatcher)
          if (redirects === MAX_REDIRECTS) throw new SourceServiceError('SOURCE_PROTOCOL_ERROR', 'Too many media redirects', 'protocol')
          current = new URL(headers.location, current)
          continue
        }
        return {
          statusCode: response.statusCode,
          headers,
          body: response.body,
          close: () => {
            if (!response.body.readableEnded && !response.body.destroyed) {
              response.body.once('error', () => {})
              response.body.destroy()
            }
            closeDispatcher(dispatcher)
          },
        }
      } catch (error) {
        closeDispatcher(dispatcher)
        if (error instanceof SourceServiceError) throw error
        if (request.signal?.aborted === true) throw new SourceServiceError('SOURCE_CANCELLED', 'Media request cancelled', 'caller')
        throw new SourceServiceError('SOURCE_NETWORK_ERROR', 'Media request failed', 'service-network')
      }
    }
    throw new SourceServiceError('SOURCE_PROTOCOL_ERROR', 'Too many media redirects', 'protocol')
  }

  async probeAudio(target: MediaTarget, signal?: AbortSignal): Promise<void> {
    const response = await this.open(target, { method: 'GET', range: `bytes=0-${AUDIO_PROBE_BYTES - 1}`, signal })
    try {
      if (availabilityStatus(response.statusCode)) throw new SourceServiceError('SOURCE_MEDIA_UNAVAILABLE', 'Audio resource is unavailable', 'service-network')
      if (response.statusCode !== 200 && response.statusCode !== 206) throw new SourceServiceError('SOURCE_MEDIA_INVALID', 'Audio response is invalid', 'service-network')
      const contentType = (response.headers['content-type'] ?? '').toLowerCase()
      if (/^(?:text\/|application\/(?:json|xml|javascript))/.test(contentType)) throw new SourceServiceError('SOURCE_MEDIA_INVALID', 'Audio response is not media', 'service-network')
      const rawLength = response.headers['content-length']
      const declaredLength = rawLength == null ? undefined : Number(rawLength)
      if (declaredLength != null && (!Number.isSafeInteger(declaredLength) || declaredLength < 0)) throw new SourceServiceError('SOURCE_MEDIA_INVALID', 'Audio content length is invalid', 'service-network')
      let expectedRangeLength: number | undefined
      if (response.statusCode === 206) {
        const parsed = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(response.headers['content-range'] ?? '')
        if (parsed == null) throw new SourceServiceError('SOURCE_MEDIA_INVALID', 'Audio range response is invalid', 'service-network')
        const start = Number(parsed[1])
        const end = Number(parsed[2])
        const total = parsed[3] === '*' ? undefined : Number(parsed[3])
        expectedRangeLength = end - start + 1
        if (start !== 0 || end < start || end >= AUDIO_PROBE_BYTES || (total != null && (!Number.isSafeInteger(total) || total <= end)) || (declaredLength != null && declaredLength !== expectedRangeLength)) {
          throw new SourceServiceError('SOURCE_MEDIA_INVALID', 'Audio range response is invalid', 'service-network')
        }
      }
      const bytes = await this.readAtMost(response.body, AUDIO_PROBE_BYTES)
      if (bytes.byteLength === 0) throw new SourceServiceError('SOURCE_MEDIA_UNAVAILABLE', 'Audio response is empty', 'service-network')
      if (expectedRangeLength != null && bytes.byteLength !== expectedRangeLength) throw new SourceServiceError('SOURCE_MEDIA_UNAVAILABLE', 'Audio range response ended early', 'service-network')
      if (declaredLength != null && declaredLength <= AUDIO_PROBE_BYTES && declaredLength !== bytes.byteLength) throw new SourceServiceError('SOURCE_MEDIA_UNAVAILABLE', 'Audio response ended early', 'service-network')
      const visiblePrefix = Buffer.from(bytes.subarray(0, 256)).toString('utf8').trimStart()
      if (/^(?:<!doctype\s+html|<html|<\?xml|\{|\[)/i.test(visiblePrefix)) throw new SourceServiceError('SOURCE_MEDIA_INVALID', 'Audio response contains an error document', 'service-network')
      const knownAudio = contentType.startsWith('audio/') || this.hasAudioSignature(bytes)
      if (!knownAudio) throw new SourceServiceError('SOURCE_MEDIA_INVALID', 'Audio response is not recognized', 'service-network')
    } finally {
      response.close()
    }
  }

  async fetchArtwork(target: MediaTarget, signal?: AbortSignal): Promise<{ bytes: Uint8Array, mimeType: string }> {
    const response = await this.open(target, { method: 'GET', signal })
    try {
      if (availabilityStatus(response.statusCode)) throw new SourceServiceError('SOURCE_MEDIA_UNAVAILABLE', 'Artwork resource is unavailable', 'service-network')
      if (response.statusCode !== 200) throw new SourceServiceError('SOURCE_MEDIA_INVALID', 'Artwork response is invalid', 'protocol')
      const declaredLength = Number(response.headers['content-length'] ?? 0)
      if (declaredLength > MAX_ARTWORK_BYTES) throw new SourceServiceError('SOURCE_RESPONSE_TOO_LARGE', 'Artwork response is too large', 'safety')
      const bytes = await this.readAtMost(response.body, MAX_ARTWORK_BYTES + 1)
      if (bytes.byteLength === 0) throw new SourceServiceError('SOURCE_MEDIA_UNAVAILABLE', 'Artwork response is empty', 'service-network')
      if (bytes.byteLength > MAX_ARTWORK_BYTES) throw new SourceServiceError('SOURCE_RESPONSE_TOO_LARGE', 'Artwork response is too large', 'safety')
      if (declaredLength > 0 && declaredLength !== bytes.byteLength) throw new SourceServiceError('SOURCE_MEDIA_UNAVAILABLE', 'Artwork response ended early', 'service-network')
      const dimensions = imageSize(bytes)
      if (dimensions.width == null || dimensions.height == null || dimensions.type == null) throw new SourceServiceError('SOURCE_MEDIA_INVALID', 'Artwork response is not an image', 'protocol')
      const mimeType = `image/${dimensions.type === 'jpg' ? 'jpeg' : dimensions.type}`
      const headerMime = (response.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
      if (headerMime !== '' && headerMime !== mimeType && !(headerMime === 'image/jpg' && mimeType === 'image/jpeg')) throw new SourceServiceError('SOURCE_MEDIA_INVALID', 'Artwork MIME type does not match its bytes', 'protocol')
      return { bytes, mimeType }
    } catch (error) {
      if (error instanceof SourceServiceError) throw error
      throw new SourceServiceError('SOURCE_MEDIA_INVALID', 'Artwork response is not an image', 'protocol')
    } finally {
      response.close()
    }
  }

  private async readAtMost(body: Readable, limit: number): Promise<Uint8Array> {
    try {
      const chunks: Buffer[] = []
      let size = 0
      for await (const value of body) {
        const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array)
        const remaining = limit - size
        if (remaining <= 0) break
        chunks.push(chunk.subarray(0, remaining))
        size += Math.min(chunk.byteLength, remaining)
        if (size >= limit) break
      }
      return Buffer.concat(chunks, size)
    } catch (error) {
      if (error instanceof SourceServiceError) throw error
      throw new SourceServiceError('SOURCE_NETWORK_ERROR', 'Media response ended unexpectedly', 'service-network')
    }
  }

  private hasAudioSignature(bytes: Uint8Array): boolean {
    const prefix = Buffer.from(bytes.subarray(0, 12))
    return prefix.subarray(0, 3).toString('ascii') === 'ID3' ||
      prefix.subarray(0, 4).toString('ascii') === 'fLaC' ||
      prefix.subarray(0, 4).toString('ascii') === 'OggS' ||
      (prefix.subarray(0, 4).toString('ascii') === 'RIFF' && prefix.subarray(8, 12).toString('ascii') === 'WAVE') ||
      (prefix.byteLength >= 2 && prefix[0] === 0xff && (prefix[1] & 0xe0) === 0xe0)
  }
}
