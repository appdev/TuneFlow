import { Readable, Transform } from 'node:stream'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { ApiError } from '../errors'
import type { PlaybackToken } from './tokenStore'
import { SourceServiceError } from '../sources/types'
import { MediaClient } from './mediaClient'

const MAX_STREAM_BYTES = 1024 * 1024 * 1024
const RESPONSE_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified', 'cache-control'] as const

const rangeIsSingle = (range: string): boolean => /^bytes=(?:\d+-\d*|-\d+)$/.test(range)

const rangeMatches = (requested: string, returned: string): boolean => {
  const actual = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(returned)
  if (actual == null) return false
  const start = Number(actual[1])
  const end = Number(actual[2])
  const total = Number(actual[3])
  if (!(start <= end && end < total)) return false
  const explicit = /^bytes=(\d+)-(\d*)$/.exec(requested)
  if (explicit != null) return start === Number(explicit[1]) && (explicit[2] === '' || end <= Number(explicit[2]))
  const suffix = /^bytes=-(\d+)$/.exec(requested)
  return suffix != null && end === total - 1 && end - start + 1 <= Number(suffix[1])
}

const readFirstChunk = async(body: Readable): Promise<{ first: Buffer, iterator: AsyncIterator<unknown> }> => {
  const iterator = body[Symbol.asyncIterator]()
  try {
    while (true) {
      const next = await iterator.next()
      if (next.done === true) throw new SourceServiceError('SOURCE_MEDIA_UNAVAILABLE', 'Playback response is empty', 'service-network')
      const chunk = Buffer.isBuffer(next.value) ? next.value : Buffer.from(next.value as Uint8Array)
      if (chunk.byteLength > 0) return { first: chunk, iterator }
    }
  } catch (error) {
    if (error instanceof SourceServiceError) throw error
    throw new SourceServiceError('SOURCE_NETWORK_ERROR', 'Playback response ended before its first byte', 'service-network')
  }
}

const limitStreamSize = (): Transform => {
  let size = 0
  return new Transform({
    transform(chunk, _encoding, callback) {
      size += chunk.length
      callback(size > MAX_STREAM_BYTES ? new ApiError(502, 'SOURCE_RESPONSE_TOO_LARGE', 'Playback response is too large') : null, chunk)
    },
  })
}

export interface PlaybackProxyOptions {
  allowPrivateNetwork?: boolean
  mediaClient?: MediaClient
}

export const proxyPlayback = async(requestFromBrowser: FastifyRequest, reply: FastifyReply, token: PlaybackToken, options: PlaybackProxyOptions = {}): Promise<void> => {
  const requestedRange = requestFromBrowser.headers.range
  if (typeof requestedRange === 'string' && !rangeIsSingle(requestedRange)) throw new ApiError(416, 'INVALID_RANGE', 'Only one byte range is supported')
  const controller = new AbortController()
  const abort = () => { controller.abort() }
  requestFromBrowser.raw.once('aborted', abort)
  reply.raw.once('close', abort)
  const mediaClient = options.mediaClient ?? new MediaClient({ allowPrivateNetwork: options.allowPrivateNetwork })
  let upstream: Awaited<ReturnType<MediaClient['open']>> | undefined
  const attempts: Array<{ sourceId: string, action: string, code: string, elapsedMs: number }> = []
  try {
    for (const candidate of token.candidates) {
      const startedAt = Date.now()
      try {
        upstream = await mediaClient.open({ url: candidate.url, headers: candidate.headers }, {
          method: requestFromBrowser.method === 'HEAD' ? 'HEAD' : 'GET',
          range: typeof requestedRange === 'string' ? requestedRange : undefined,
          ifRange: typeof requestFromBrowser.headers['if-range'] === 'string' ? requestFromBrowser.headers['if-range'] : undefined,
          signal: controller.signal,
        })
        const retryableStatus = [401, 403, 404, 408, 410, 429].includes(upstream.statusCode) || upstream.statusCode >= 500
        if (retryableStatus) throw new SourceServiceError('SOURCE_MEDIA_UNAVAILABLE', 'Playback resource is unavailable', 'service-network')
        if (upstream.statusCode !== 200 && upstream.statusCode !== 206) throw new SourceServiceError('SOURCE_MEDIA_INVALID', 'Playback response status is invalid', 'service-network')
        if (typeof requestedRange === 'string' && upstream.statusCode === 206 && !rangeMatches(requestedRange, upstream.headers['content-range'] ?? '')) {
          throw new SourceServiceError('SOURCE_MEDIA_INVALID', 'Playback range response is invalid', 'service-network')
        }
        const contentType = (upstream.headers['content-type'] ?? '').toLowerCase()
        if (/^(?:text\/|application\/(?:json|xml|javascript))/.test(contentType)) throw new SourceServiceError('SOURCE_MEDIA_INVALID', 'Playback response is not audio', 'service-network')
        const rawContentLength = upstream.headers['content-length']
        const contentLength = rawContentLength == null ? undefined : Number(rawContentLength)
        if (contentLength != null && (!Number.isFinite(contentLength) || contentLength > MAX_STREAM_BYTES)) throw new ApiError(502, 'SOURCE_RESPONSE_TOO_LARGE', 'Playback response is too large')
        if (contentLength === 0 && requestFromBrowser.method !== 'HEAD') throw new SourceServiceError('SOURCE_MEDIA_UNAVAILABLE', 'Playback response is empty', 'service-network')
        const headers: Record<string, string> = {}
        for (const name of RESPONSE_HEADERS) {
          const value = upstream.headers[name]
          if (typeof value === 'string') {
            headers[name] = name === 'content-type' && value.toLowerCase() === 'audio/x-flac'
              ? 'audio/flac'
              : value
          }
        }
        if (requestFromBrowser.method === 'HEAD') {
          void reply.code(upstream.statusCode).headers(headers)
          upstream.close()
          upstream = undefined
          await reply.send()
        } else {
          const { first, iterator } = await readFirstChunk(upstream.body)
          const output = limitStreamSize()
          const opened = upstream
          const body = Readable.from((async function * () {
            yield first
            while (true) {
              const next = await iterator.next()
              if (next.done === true) return
              yield next.value
            }
          })())
          body.on('error', error => { output.destroy(error) })
          upstream.body.once('close', () => { opened.close() })
          void reply.code(upstream.statusCode).headers(headers)
          await reply.send(body.pipe(output))
          upstream = undefined
        }
        return
      } catch (error) {
        upstream?.close()
        upstream = undefined
        if (controller.signal.aborted) return
        if (error instanceof SourceServiceError && error.origin === 'service-network') {
          attempts.push({ sourceId: candidate.sourceId, action: 'stream', code: error.code, elapsedMs: Date.now() - startedAt })
          continue
        }
        throw error
      }
    }
    throw new ApiError(502, 'SOURCE_ALL_UNAVAILABLE', 'All playback sources are unavailable', { attempts })
  } catch (error) {
    upstream?.close()
    if (error instanceof ApiError) throw error
    if (controller.signal.aborted) return
    if (error instanceof SourceServiceError) throw new ApiError(502, error.code, error.message)
    throw new ApiError(502, 'SOURCE_PROTOCOL_ERROR', 'Playback source request failed')
  } finally {
    requestFromBrowser.raw.removeListener('aborted', abort)
    reply.raw.removeListener('close', abort)
  }
}
