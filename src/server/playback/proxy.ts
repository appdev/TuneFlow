import { lookup as dnsLookup } from 'node:dns/promises'
import { Transform } from 'node:stream'
import { Agent, request, type Dispatcher } from 'undici'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { ApiError } from '../errors'
import type { PlaybackToken } from './tokenStore'
import { isBlockedAddress } from '../sources/network'

const MAX_REDIRECTS = 5
const MAX_STREAM_BYTES = 1024 * 1024 * 1024
const RESPONSE_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified', 'cache-control'] as const

const validateTarget = async(target: URL, allowPrivateNetwork: boolean): Promise<string[]> => {
  if (target.protocol !== 'http:' && target.protocol !== 'https:') throw new ApiError(502, 'SOURCE_TARGET_BLOCKED', 'Playback target is not allowed')
  const addresses = (await dnsLookup(target.hostname, { all: true, verbatim: true })).map(result => result.address)
  if (!allowPrivateNetwork && addresses.some(isBlockedAddress)) throw new ApiError(502, 'SOURCE_TARGET_BLOCKED', 'Playback target is not allowed')
  return addresses
}

const rangeIsSingle = (range: string): boolean => /^bytes=(?:\d+-\d*|-\d+)$/.test(range)

const closeDispatcher = (dispatcher: Dispatcher): void => { void dispatcher.close().catch(() => {}) }

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
}

export const proxyPlayback = async(requestFromBrowser: FastifyRequest, reply: FastifyReply, token: PlaybackToken, options: PlaybackProxyOptions = {}): Promise<void> => {
  const requestedRange = requestFromBrowser.headers.range
  if (typeof requestedRange === 'string' && !rangeIsSingle(requestedRange)) throw new ApiError(416, 'INVALID_RANGE', 'Only one byte range is supported')
  const controller = new AbortController()
  const abort = () => { controller.abort() }
  requestFromBrowser.raw.once('aborted', abort)
  reply.raw.once('close', abort)
  let target: URL
  let dispatcher: Dispatcher | undefined
  try {
    try { target = new URL(token.url) } catch { throw new ApiError(502, 'SOURCE_PROTOCOL_ERROR', 'Invalid playback target') }
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
      const addresses = await validateTarget(target, options.allowPrivateNetwork === true)
      dispatcher = new Agent({
        connect: {
          lookup: (_hostname, lookupOptions, callback) => {
            const resolved = addresses.map(address => ({ address, family: address.includes(':') ? 6 : 4 }))
            if (lookupOptions.all) callback(null, resolved)
            else callback(null, resolved[0].address, resolved[0].family)
          },
        },
      })
      const upstream = await request(target, {
        method: requestFromBrowser.method === 'HEAD' ? 'HEAD' : 'GET',
        headers: {
          ...token.headers,
          ...(typeof requestedRange === 'string' ? { range: requestedRange } : {}),
          ...(typeof requestFromBrowser.headers['if-range'] === 'string' ? { 'if-range': requestFromBrowser.headers['if-range'] } : {}),
        },
        dispatcher,
        signal: controller.signal,
        headersTimeout: 15_000,
        bodyTimeout: 15_000,
      })
      const location = upstream.headers.location
      if (upstream.statusCode >= 300 && upstream.statusCode < 400 && typeof location === 'string') {
        await upstream.body.dump()
        closeDispatcher(dispatcher)
        dispatcher = undefined
        if (redirects === MAX_REDIRECTS) throw new ApiError(502, 'SOURCE_PROTOCOL_ERROR', 'Too many playback redirects')
        target = new URL(location, target)
        continue
      }
      const contentLength = Number(upstream.headers['content-length'] ?? 0)
      if (!Number.isFinite(contentLength) || contentLength > MAX_STREAM_BYTES) {
        upstream.body.destroy()
        throw new ApiError(502, 'SOURCE_RESPONSE_TOO_LARGE', 'Playback response is too large')
      }
      const headers: Record<string, string> = {}
      for (const name of RESPONSE_HEADERS) {
        const value = upstream.headers[name]
        if (typeof value === 'string') {
          headers[name] = name === 'content-type' && value.toLowerCase() === 'audio/x-flac'
            ? 'audio/flac'
            : value
        }
      }
      void reply.code(upstream.statusCode).headers(headers)
      if (requestFromBrowser.method === 'HEAD') {
        await upstream.body.dump()
        closeDispatcher(dispatcher)
        dispatcher = undefined
        await reply.send()
      } else {
        const output = limitStreamSize()
        const streamDispatcher = dispatcher
        upstream.body.on('error', error => { output.destroy(error) })
        upstream.body.once('close', () => { closeDispatcher(streamDispatcher) })
        await reply.send(upstream.body.pipe(output))
      }
      return
    }
  } catch (error) {
    if (dispatcher != null) closeDispatcher(dispatcher)
    if (error instanceof ApiError) throw error
    if (controller.signal.aborted) return
    throw new ApiError(502, 'SOURCE_PROTOCOL_ERROR', 'Playback source request failed')
  } finally {
    requestFromBrowser.raw.removeListener('aborted', abort)
    reply.raw.removeListener('close', abort)
  }
}
