import { createServer as createHttpServer, get as httpGet } from 'node:http'
import { once } from 'node:events'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import Fastify from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TokenStore } from './tokenStore'
import { PlaybackResolver } from './resolver'
import { registerPlaybackRoutes } from '../routes/playback'
import type { SourcesService } from '../routes/sources'
import { isBlockedAddress } from '../sources/network'
import { LibraryScanner } from '../library/scanner'
import { registerLibraryRoutes } from '../routes/library'
import { PlaybackResourceStore } from './resourceStore'
import { createServer as createTuneFlowServer } from '../app'

const bytes = Buffer.from(Array.from({ length: 128 }, (_, index) => index))
const apps: Array<ReturnType<typeof Fastify>> = []
const servers: Array<ReturnType<typeof createHttpServer>> = []
const tempRoots: string[] = []

const startUpstream = async(contentType = 'audio/mpeg'): Promise<{ url: string, requests: Array<{ method?: string, range?: string, ifRange?: string, sourceHeader?: string }> }> => {
  const requests: Array<{ method?: string, range?: string, ifRange?: string, sourceHeader?: string }> = []
  const server = createHttpServer((request, response) => {
    requests.push({ method: request.method, range: typeof request.headers.range === 'string' ? request.headers.range : undefined, ifRange: typeof request.headers['if-range'] === 'string' ? request.headers['if-range'] : undefined, sourceHeader: typeof request.headers['x-source-required'] === 'string' ? request.headers['x-source-required'] : undefined })
    const range = request.headers.range
    const match = typeof range === 'string' && /^bytes=(?:(\d+)-(\d*)|-(\d+))$/.exec(range)
    if (range != null && match == null) {
      response.writeHead(416, { 'content-range': `bytes */${bytes.length}` })
      response.end()
      return
    }
    if (Array.isArray(match)) {
      const start = match[3] == null ? Number(match[1]) : Math.max(0, bytes.length - Number(match[3]))
      const end = match[3] != null || match[2] === '' ? bytes.length - 1 : Number(match[2])
      if (start > end || end >= bytes.length) {
        response.writeHead(416, { 'content-range': `bytes */${bytes.length}` })
        response.end()
        return
      }
      response.writeHead(206, {
        'content-type': contentType,
        'content-length': end - start + 1,
        'content-range': `bytes ${start}-${end}/${bytes.length}`,
        'accept-ranges': 'bytes',
        etag: '"fixture"',
      })
      if (request.method !== 'HEAD') response.end(bytes.subarray(start, end + 1))
      else response.end()
      return
    }
    response.writeHead(200, { 'content-type': contentType, 'content-length': bytes.length, 'accept-ranges': 'bytes', etag: '"fixture"' })
    if (request.method !== 'HEAD') response.end(bytes)
    else response.end()
  })
  servers.push(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/deterministic-audio`, requests }
}

const playbackApp = (store = new TokenStore(), resourceStore?: PlaybackResourceStore): ReturnType<typeof Fastify> => {
  const app = Fastify({ logger: false })
  apps.push(app)
  registerPlaybackRoutes(app, {
    tokenStore: store,
    resourceStore,
    resolveTrack: async() => ({ url: 'http://example.invalid/never-expose', quality: '128k' as TuneFlow.Quality, expiresAt: Date.now() + 300_000 }),
    allowPrivateNetwork: true,
  })
  return app
}

afterEach(async() => {
  await Promise.all(apps.splice(0).map(app => app.close()))
  await Promise.all(servers.splice(0).map(async server => new Promise<void>(resolve => server.close(() => { resolve() }))))
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('same-origin playback proxy', () => {
  it('uses the configured source chain to return a complete backup bundle', async() => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'tuneflow-multi-source-integration-'))
    tempRoots.push(root)
    const webRoot = path.join(root, 'web')
    mkdirSync(webRoot)
    writeFileSync(path.join(webRoot, 'index.html'), '<!doctype html><title>fixture</title>')
    const audio = readFileSync(path.join(process.cwd(), 'src/renderer/assets/medias/Silence02s.mp3'))
    const picture = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
    const upstream = createHttpServer((request, response) => {
      if (request.url === '/a') {
        response.writeHead(503).end('offline')
        return
      }
      if (request.url === '/picture') {
        response.writeHead(200, { 'content-type': 'image/png', 'content-length': picture.length }).end(picture)
        return
      }
      const range = request.headers.range
      if (range != null) {
        response.writeHead(206, {
          'content-type': 'audio/mpeg',
          'content-length': audio.length,
          'content-range': `bytes 0-${audio.length - 1}/${audio.length}`,
        }).end(audio)
        return
      }
      response.writeHead(200, { 'content-type': 'audio/mpeg', 'content-length': audio.length }).end(audio)
    })
    servers.push(upstream)
    upstream.listen(0, '127.0.0.1')
    await once(upstream, 'listening')
    const origin = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`
    const sourceScript = (name: string, audioUrl: string, lyric: string, pictureUrl?: string) => `/*
 * @name ${name}
 * @description Multi-source integration fixture
 * @version 1.0.0
 */
window.tuneflow.on(window.tuneflow.EVENT_NAMES.request, ({ action }) => {
  if (action === 'musicUrl') return '${audioUrl}'
  if (action === 'lyric') return { lyric: '${lyric}' }
  if (action === 'pic') return '${pictureUrl ?? `${origin}/picture`}'
})
window.tuneflow.send(window.tuneflow.EVENT_NAMES.inited, {
  sources: { kw: { type: 'music', actions: ['musicUrl', 'lyric', 'pic'], qualitys: ['128k'] } },
})`
    const previousPlaybackFlag = process.env.TUNEFLOW_TEST_ALLOW_PRIVATE_PLAYBACK_TARGETS
    process.env.TUNEFLOW_TEST_ALLOW_PRIVATE_PLAYBACK_TARGETS = '1'
    const app = await createTuneFlowServer({ storageRoot: root, webRoot, host: '127.0.0.1', port: 0 })
    apps.push(app)
    try {
      const first = (await app.inject({ method: 'POST', url: '/api/v1/sources', payload: { script: sourceScript('Source A', `${origin}/a`, '[00:00]a') } })).json().data
      const second = (await app.inject({ method: 'POST', url: '/api/v1/sources', payload: { script: sourceScript('Source B', `${origin}/b`, '[00:00]b') } })).json().data
      await app.inject({ method: 'PUT', url: '/api/v1/sources/enabled', payload: { sourceIds: [first.id, second.id] } })

      const resolved = await app.inject({
        method: 'POST',
        url: '/api/v1/playback/tracks/resolve',
        payload: { source: 'kw', quality: '128k', info: { id: 'track', name: 'Song', singer: 'Singer', source: 'kw' } },
      })

      expect(resolved.statusCode).toBe(200)
      expect(resolved.json().data).toMatchObject({
        url: expect.stringMatching(/^\/api\/v1\/streams\/[a-f0-9]{64}$/),
        resources: {
          lyrics: { lyric: '[00:00]b' },
          pictureUrl: expect.stringMatching(/^\/api\/v1\/playback\/resources\/[a-f0-9]{64}\/picture$/),
        },
        completeness: 'complete',
      })
      expect(resolved.body).not.toContain(origin)
    } finally {
      if (previousPlaybackFlag == null) delete process.env.TUNEFLOW_TEST_ALLOW_PRIVATE_PLAYBACK_TARGETS
      else process.env.TUNEFLOW_TEST_ALLOW_PRIVATE_PLAYBACK_TARGETS = previousPlaybackFlag
    }
  })

  it('converts canonical Web music info to the desktop custom-source contract', async() => {
    const requestSource = vi.fn().mockResolvedValue({ url: 'https://example.test/audio' })
    const sources = {
      list: () => [{ id: 'user_api_fixture', active: true }],
      requestSource,
    } as unknown as SourcesService
    const resolver = new PlaybackResolver(sources, new TokenStore())

    await resolver.resolveTrack({
      source: 'wy',
      quality: '128k' as TuneFlow.Quality,
      info: {
        type: '128k',
        musicInfo: {
          id: 'wy_156374',
          name: '突然的自我',
          singer: '伍佰 & China Blue',
          source: 'wy',
          interval: '03:35',
          meta: {
            songId: '156374',
            albumName: '忘情1015精选辑',
            picUrl: 'https://example.test/cover',
            albumId: 15751,
            qualitys: [{ type: '128k', size: '3.28 MB' }],
            _qualitys: { '128k': { size: '3.28 MB' } },
          },
        },
      },
    })

    expect(requestSource).toHaveBeenCalledWith('user_api_fixture', {
      source: 'wy',
      action: 'musicUrl',
      info: {
        type: '128k',
        musicInfo: expect.objectContaining({
          songmid: '156374',
          albumName: '忘情1015精选辑',
          albumId: 15751,
          img: 'https://example.test/cover',
          types: [{ type: '128k', size: '3.28 MB' }],
          _types: { '128k': { size: '3.28 MB' } },
        }),
      },
    })
  })

  it('matches the desktop player by retrying an equivalent track from another provider', async() => {
    const requestSource = vi.fn()
      .mockRejectedValueOnce(new Error('get music url failed'))
      .mockResolvedValueOnce({ url: 'https://example.test/fallback-audio' })
    const sources = {
      list: () => [{ id: 'user_api_fixture', active: true }],
      requestSource,
    } as unknown as SourcesService
    const findAlternatives = vi.fn(async() => [{
      source: 'wy',
      songmid: '29723021',
      name: '晚风',
      singer: '伍佰 & China Blue',
      albumName: '泪桥',
      interval: '03:45',
      _types: { '128k': { size: '3.4 MB' } },
    }])
    const resolver = new PlaybackResolver(sources, new TokenStore(), findAlternatives)

    const result = await resolver.resolveTrack({
      source: 'tx',
      quality: '128k' as TuneFlow.Quality,
      info: {
        type: '128k',
        musicInfo: {
          id: 'tx_002qcUIi4WaXqr',
          name: '晚风',
          singer: '伍佰 & China Blue',
          source: 'tx',
          interval: '03:45',
          meta: { songId: '002qcUIi4WaXqr', albumName: '泪桥', _qualitys: { '128k': { size: '3.4 MB' } } },
        },
      },
    })

    expect(result.url).toMatch(/^\/api\/v1\/streams\/[a-f\d]{64}$/)
    expect(findAlternatives).toHaveBeenCalledWith(expect.objectContaining({ name: '晚风', source: 'tx' }))
    expect(requestSource).toHaveBeenNthCalledWith(2, 'user_api_fixture', {
      source: 'wy',
      action: 'musicUrl',
      info: { type: '128k', musicInfo: expect.objectContaining({ songmid: '29723021', name: '晚风' }) },
    })
  })

  it('prefers a completed local download before requesting the original provider by default', async() => {
    const requestSource = vi.fn().mockResolvedValue({ url: 'https://example.test/should-not-be-used' })
    const sources = {
      list: () => [{ id: 'user_api_fixture', active: true }],
      requestSource,
    } as unknown as SourcesService
    const findAlternatives = vi.fn(async() => [{ source: 'wy', songmid: 'online-fallback' }])
    const localUrl = `/api/v1/library/tracks/${'a'.repeat(64)}/stream`
    const findLocal = vi.fn(() => localUrl)
    const resolver = new PlaybackResolver(sources, new TokenStore(), findAlternatives, findLocal)

    await expect(resolver.resolveTrack({
      source: 'kw',
      quality: '128k' as TuneFlow.Quality,
      info: { id: 'track-1', name: '晚风', singer: '伍佰', source: 'kw' },
    })).resolves.toMatchObject({ url: localUrl, quality: '128k' })
    expect(findLocal).toHaveBeenCalledWith(expect.objectContaining({ id: 'track-1' }))
    expect(findAlternatives).not.toHaveBeenCalled()
    expect(requestSource).not.toHaveBeenCalled()
  })

  it('uses a completed local download immediately when refreshing a failed stream URL', async() => {
    const requestSource = vi.fn().mockResolvedValue({ url: 'https://example.test/should-not-be-used' })
    const sources = {
      list: () => [{ id: 'user_api_fixture', active: true }],
      requestSource,
    } as unknown as SourcesService
    const localUrl = `/api/v1/library/tracks/${'b'.repeat(64)}/stream`
    const findLocal = vi.fn(() => localUrl)
    const resolver = new PlaybackResolver(sources, new TokenStore(), undefined, findLocal)

    await expect(resolver.resolveTrack({
      source: 'kw',
      quality: '128k' as TuneFlow.Quality,
      preferLocal: true,
      info: { type: '128k', musicInfo: { id: 'track-1', name: '晚风', singer: '伍佰', source: 'kw' } },
    })).resolves.toMatchObject({ url: localUrl })
    expect(requestSource).not.toHaveBeenCalled()
  })

  it('preserves the upstream failure when the active source does not support a fallback provider', async() => {
    const upstreamError = Object.assign(new Error('source endpoint DNS lookup failed'), { code: 'SOURCE_NETWORK_ERROR' })
    const requestSource = vi.fn().mockRejectedValue(upstreamError)
    const sources = {
      list: () => [{
        id: 'user_api_fixture',
        active: true,
        sources: { kw: { type: 'music', actions: ['musicUrl'], qualitys: ['128k'] } },
      }],
      requestSource,
    } as unknown as SourcesService
    const findAlternatives = vi.fn(async() => [{ source: 'wy', songmid: 'unsupported-fallback' }])
    const resolver = new PlaybackResolver(sources, new TokenStore(), findAlternatives)

    await expect(resolver.resolveTrack({
      source: 'kw',
      quality: '128k' as TuneFlow.Quality,
      info: { name: '晚风', singer: '伍佰', source: 'kw' },
    })).rejects.toBe(upstreamError)
    expect(requestSource).toHaveBeenCalledTimes(1)
  })

  it('streams a full GET without leaking its target URL', async() => {
    const upstream = await startUpstream()
    const store = new TokenStore()
    const token = store.create({ url: upstream.url, headers: { 'x-source-required': 'required', cookie: 'must-not-forward' } })
    const app = playbackApp(store)

    const response = await app.inject({ method: 'GET', url: `/api/v1/streams/${token}` })

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toBe('audio/mpeg')
    expect(response.rawPayload).toEqual(bytes)
    expect(upstream.requests).toEqual([{ method: 'GET', sourceHeader: 'required' }])
    expect(response.body).not.toContain(upstream.url)
  })

  it('tries the next validated stream candidate before committing response bytes', async() => {
    let unavailableRequests = 0
    const unavailable = createHttpServer((_request, response) => {
      unavailableRequests++
      response.writeHead(503, { 'content-type': 'text/plain' }).end('offline')
    })
    servers.push(unavailable)
    unavailable.listen(0, '127.0.0.1')
    await once(unavailable, 'listening')
    const fallback = await startUpstream()
    const store = new TokenStore()
    const token = store.create({
      candidates: [
        { sourceId: 'a', url: `http://127.0.0.1:${(unavailable.address() as AddressInfo).port}/audio` },
        { sourceId: 'b', url: fallback.url },
      ],
    })
    const app = playbackApp(store)

    const response = await app.inject({ method: 'GET', url: `/api/v1/streams/${token}` })

    expect(response.statusCode).toBe(200)
    expect(response.rawPayload).toEqual(bytes)
    expect(unavailableRequests).toBe(1)
    expect(fallback.requests).toHaveLength(1)
  })

  it('falls back when a candidate disconnects before its first byte', async() => {
    const failing = createHttpServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'audio/mpeg' })
      response.destroy()
    })
    servers.push(failing)
    failing.listen(0, '127.0.0.1')
    await once(failing, 'listening')
    const fallback = await startUpstream()
    const store = new TokenStore()
    const token = store.create({
      candidates: [
        { sourceId: 'a', url: `http://127.0.0.1:${(failing.address() as AddressInfo).port}/audio` },
        { sourceId: 'b', url: fallback.url },
      ],
    })
    const app = playbackApp(store)

    const response = await app.inject({ method: 'GET', url: `/api/v1/streams/${token}` })

    expect(response.statusCode).toBe(200)
    expect(response.rawPayload).toEqual(bytes)
    expect(fallback.requests).toHaveLength(1)
  })

  it('streams valid chunked audio without a content-length header', async() => {
    const chunked = createHttpServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'audio/mpeg' })
      response.write(bytes.subarray(0, 16))
      response.end(bytes.subarray(16))
    })
    servers.push(chunked)
    chunked.listen(0, '127.0.0.1')
    await once(chunked, 'listening')
    const store = new TokenStore()
    const token = store.create({ url: `http://127.0.0.1:${(chunked.address() as AddressInfo).port}/audio` })
    const app = playbackApp(store)

    const response = await app.inject({ method: 'GET', url: `/api/v1/streams/${token}` })

    expect(response.statusCode).toBe(200)
    expect(response.rawPayload).toEqual(bytes)
  })

  it('never appends a second source after the first source commits bytes', async() => {
    const failing = createHttpServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'audio/mpeg', 'content-length': 128 })
      response.write(Buffer.from('ID3partial'))
      setTimeout(() => { response.destroy(new Error('mid-stream failure')) }, 5)
    })
    servers.push(failing)
    failing.listen(0, '127.0.0.1')
    await once(failing, 'listening')
    const fallback = await startUpstream()
    const store = new TokenStore()
    const token = store.create({
      candidates: [
        { sourceId: 'a', url: `http://127.0.0.1:${(failing.address() as AddressInfo).port}/audio` },
        { sourceId: 'b', url: fallback.url },
      ],
    })
    const app = playbackApp(store)

    await app.inject({ method: 'GET', url: `/api/v1/streams/${token}` }).catch(() => undefined)

    expect(fallback.requests).toEqual([])
  })

  it('serves cached artwork through an opaque same-origin resource path', async() => {
    const resources = new PlaybackResourceStore()
    const picture = resources.putPicture({ bytes: Uint8Array.from([1, 2, 3]), mimeType: 'image/png' })
    const app = playbackApp(new TokenStore(), resources)

    const get = await app.inject({ method: 'GET', url: `/api/v1/playback/resources/${picture.token}/picture` })
    const head = await app.inject({ method: 'HEAD', url: `/api/v1/playback/resources/${picture.token}/picture` })
    const expired = await app.inject({ method: 'GET', url: '/api/v1/playback/resources/missing/picture' })

    expect(get.statusCode).toBe(200)
    expect(get.headers['content-type']).toBe('image/png')
    expect(get.rawPayload).toEqual(Buffer.from([1, 2, 3]))
    expect(head.statusCode).toBe(200)
    expect(head.rawPayload).toEqual(Buffer.alloc(0))
    expect(expired.statusCode).toBe(410)
    expect(expired.body).not.toContain('http')
  })

  it('canonicalizes legacy FLAC content type for native media frameworks', async() => {
    const upstream = await startUpstream('audio/x-flac')
    const store = new TokenStore()
    const token = store.create({ url: upstream.url })
    const app = playbackApp(store)

    const response = await app.inject({ method: 'GET', url: `/api/v1/streams/${token}` })

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toBe('audio/flac')
  })

  it('follows an upstream redirect without emitting an unhandled stream error', async() => {
    const upstream = await startUpstream()
    const redirectServer = createHttpServer((_request, response) => {
      response.writeHead(302, { location: upstream.url })
      response.end()
    })
    servers.push(redirectServer)
    redirectServer.listen(0, '127.0.0.1')
    await once(redirectServer, 'listening')
    const redirectUrl = `http://127.0.0.1:${(redirectServer.address() as AddressInfo).port}/redirect`
    const store = new TokenStore()
    const token = store.create({ url: redirectUrl })
    const app = playbackApp(store)

    const response = await app.inject({ method: 'GET', url: `/api/v1/streams/${token}` })

    expect(response.statusCode).toBe(200)
    expect(response.rawPayload).toEqual(bytes)
  })

  it('keeps the Service alive when the browser cancels an active stream', async() => {
    const slowUpstream = createHttpServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'audio/mpeg', 'content-length': 1024 * 1024 })
      response.write(Buffer.alloc(64 * 1024, 1))
      const timer = setInterval(() => { response.write(Buffer.alloc(64 * 1024, 2)) }, 25)
      response.once('close', () => { clearInterval(timer) })
    })
    servers.push(slowUpstream)
    slowUpstream.listen(0, '127.0.0.1')
    await once(slowUpstream, 'listening')
    const store = new TokenStore()
    const token = store.create({ url: `http://127.0.0.1:${(slowUpstream.address() as AddressInfo).port}/slow` })
    const app = playbackApp(store)
    await app.listen({ host: '127.0.0.1', port: 0 })
    const appAddress = app.server.address() as AddressInfo

    await new Promise<void>((resolve, reject) => {
      const clientRequest = httpGet(`http://127.0.0.1:${appAddress.port}/api/v1/streams/${token}`, response => {
        response.once('data', () => {
          clientRequest.destroy()
          resolve()
        })
      })
      clientRequest.once('error', error => {
        if ((error as NodeJS.ErrnoException).code === 'ECONNRESET') resolve()
        else reject(error)
      })
    })
    await new Promise(resolve => setTimeout(resolve, 50))

    const probe = await app.inject({ method: 'GET', url: '/api/v1/streams/not-a-token' })
    expect(probe.statusCode).toBe(410)
  })

  it('keeps the Service alive when the upstream source fails mid-stream', async() => {
    const failingUpstream = createHttpServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'audio/mpeg', 'content-length': 1024 * 1024 })
      response.write(Buffer.alloc(1024, 1))
      setTimeout(() => { response.destroy(new Error('fixture upstream reset')) }, 10)
    })
    servers.push(failingUpstream)
    failingUpstream.listen(0, '127.0.0.1')
    await once(failingUpstream, 'listening')
    const store = new TokenStore()
    const token = store.create({ url: `http://127.0.0.1:${(failingUpstream.address() as AddressInfo).port}/failing` })
    const app = playbackApp(store)

    await app.inject({ method: 'GET', url: `/api/v1/streams/${token}` }).catch(() => undefined)
    await new Promise(resolve => setTimeout(resolve, 50))

    const probe = await app.inject({ method: 'GET', url: '/api/v1/streams/not-a-token' })
    expect(probe.statusCode).toBe(410)
  })

  it('proxies HEAD and one byte range including the upstream 206 metadata', async() => {
    const upstream = await startUpstream()
    const store = new TokenStore()
    const token = store.create({ url: upstream.url, headers: { 'x-source-required': 'required' } })
    const app = playbackApp(store)

    const head = await app.inject({ method: 'HEAD', url: `/api/v1/streams/${token}` })
    const range = await app.inject({ method: 'GET', url: `/api/v1/streams/${token}`, headers: { range: 'bytes=10-19', 'if-range': '"fixture"', authorization: 'never-forward' } })

    expect(head.statusCode).toBe(200)
    expect(head.headers['content-length']).toBe('128')
    expect(head.rawPayload).toEqual(Buffer.alloc(0))
    expect(range.statusCode).toBe(206)
    expect(range.headers['content-range']).toBe('bytes 10-19/128')
    expect(range.rawPayload).toEqual(bytes.subarray(10, 20))
    expect(upstream.requests).toEqual([
      { method: 'HEAD', sourceHeader: 'required' },
      { method: 'GET', range: 'bytes=10-19', ifRange: '"fixture"', sourceHeader: 'required' },
    ])
  })

  it('returns 416 for invalid or multi-ranges without contacting the upstream', async() => {
    const upstream = await startUpstream()
    const store = new TokenStore()
    const token = store.create({ url: upstream.url })
    const app = playbackApp(store)

    const responses = await Promise.all(['bytes=', 'bytes=123', 'bytes=0-1,5-6'].map(range => app.inject({ method: 'GET', url: `/api/v1/streams/${token}`, headers: { range } })))

    expect(responses.map(response => response.statusCode)).toEqual([416, 416, 416])
    expect(upstream.requests).toEqual([])
    expect(responses.every(response => !response.body.includes(upstream.url))).toBe(true)
  })

  it('forwards valid open and suffix single ranges', async() => {
    const upstream = await startUpstream()
    const store = new TokenStore()
    const token = store.create({ url: upstream.url })
    const app = playbackApp(store)

    const open = await app.inject({ method: 'GET', url: `/api/v1/streams/${token}`, headers: { range: 'bytes=120-' } })
    const suffix = await app.inject({ method: 'GET', url: `/api/v1/streams/${token}`, headers: { range: 'bytes=-8' } })

    expect(open.statusCode).toBe(206)
    expect(open.rawPayload).toEqual(bytes.subarray(120))
    expect(suffix.statusCode).toBe(206)
    expect(suffix.rawPayload).toEqual(bytes.subarray(120))
    expect(upstream.requests.map(request => request.range)).toEqual(['bytes=120-', 'bytes=-8'])
  })

  it('returns 410 after a token expires and uses 256-bit opaque tokens', async() => {
    let now = 1_000
    const store = new TokenStore({ now: () => now })
    const token = store.create({ url: 'https://upstream.example/audio' })
    const app = playbackApp(store)

    const valid = store.get(token)
    now = 301_001
    const response = await app.inject({ method: 'GET', url: `/api/v1/streams/${token}` })

    expect(token).toMatch(/^[a-f0-9]{64}$/)
    expect(valid?.expiresAt).toBe(301_000)
    expect(response.statusCode).toBe(410)
    expect(response.body).not.toContain('https://upstream.example/audio')
  })

  it('does not authorize caller-selected list ids or paths as library files', async() => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'tuneflow-library-registry-'))
    tempRoots.push(root)
    mkdirSync(path.join(root, 'audio'))
    writeFileSync(path.join(root, 'private.txt'), 'private')
    const libraryBytes = readFileSync(path.join(process.cwd(), 'src/renderer/assets/medias/Silence02s.mp3'))
    writeFileSync(path.join(root, 'audio', 'fixture.mp3'), libraryBytes)
    const registry = new LibraryScanner(root, () => [path.join(root, 'audio')])
    const restartedRegistry = new LibraryScanner(root, () => [path.join(root, 'audio')])
    await registry.refresh()
    await restartedRegistry.refresh()
    const app = Fastify()
    apps.push(app)
    registerLibraryRoutes(app, registry)

    const attack = await app.inject({ method: 'GET', url: '/api/v1/library/tracks/attacker-chosen-id/stream' })
    const entry = registry.list().find(item => item.size === libraryBytes.length)!
    expect(restartedRegistry.list().find(item => item.size === libraryBytes.length)?.id).toBe(entry.id)
    const listing = await app.inject({ method: 'GET', url: '/api/v1/library/tracks' })
    const safe = await app.inject({ method: 'GET', url: `/api/v1/library/tracks/${entry.id}/stream` })
    const open = await app.inject({ method: 'GET', url: `/api/v1/library/tracks/${entry.id}/stream`, headers: { range: 'bytes=120-' } })
    const suffix = await app.inject({ method: 'GET', url: `/api/v1/library/tracks/${entry.id}/stream`, headers: { range: 'bytes=-8' } })
    const zeroSuffix = await app.inject({ method: 'GET', url: `/api/v1/library/tracks/${entry.id}/stream`, headers: { range: 'bytes=-0' } })

    expect(attack.statusCode).toBe(404)
    expect(listing.json().data).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: entry.id, size: libraryBytes.length }),
    ]))
    expect(listing.body).not.toContain(root)
    expect(safe.statusCode).toBe(200)
    expect(safe.rawPayload).toEqual(libraryBytes)
    expect(open.statusCode).toBe(206)
    expect(open.rawPayload).toEqual(libraryBytes.subarray(120))
    expect(suffix.statusCode).toBe(206)
    expect(suffix.rawPayload).toEqual(libraryBytes.subarray(libraryBytes.length - 8))
    expect(zeroSuffix.statusCode).toBe(416)
    expect(zeroSuffix.headers['content-range']).toBe(`bytes */${libraryBytes.length}`)
    expect(JSON.stringify(registry.list())).not.toContain(path.join(root, 'audio'))
  })

  it('selects routes without exposing resolver targets', async() => {
    const app = Fastify()
    apps.push(app)
    app.setErrorHandler((error, _request, reply) => {
      if ('validation' in error) return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Request validation failed' } })
      return reply.send(error)
    })
    registerPlaybackRoutes(app, {
      resolveTrack: async() => ({
        url: '/api/v1/streams/opaque-token',
        quality: '128k' as TuneFlow.Quality,
        expiresAt: 123,
        resources: { lyrics: { lyric: '[00:00]bundle' }, pictureUrl: '/api/v1/playback/resources/picture-token/picture' },
        completeness: 'complete',
      }),
    })

    const invalid = await app.inject({ method: 'POST', url: '/api/v1/playback/tracks/resolve', payload: { source: '', quality: '128k', info: {} } })
    const resolved = await app.inject({ method: 'POST', url: '/api/v1/playback/tracks/resolve', payload: { source: 'kw', quality: '128k', info: {} } })

    expect(invalid.statusCode).toBe(400)
    expect(resolved.json()).toEqual({
      data: {
        url: '/api/v1/streams/opaque-token',
        quality: '128k',
        expiresAt: 123,
        resources: { lyrics: { lyric: '[00:00]bundle' }, pictureUrl: '/api/v1/playback/resources/picture-token/picture' },
        completeness: 'complete',
      },
    })
    expect(resolved.body).not.toContain('http://')
    expect(resolved.body).not.toContain('https://')
  })

  it('blocks mapped IPv4 and IPv6 private address variants', () => {
    expect(['::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:169.254.1.1', 'fc00::1', 'fd12::1'].every(isBlockedAddress)).toBe(true)
    expect(isBlockedAddress('2001:4860:4860::8888')).toBe(false)
    expect(isBlockedAddress('8.8.8.8')).toBe(false)
  })
})
