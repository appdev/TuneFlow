import { createServer as createHttpServer, get as httpGet } from 'node:http'
import { once } from 'node:events'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
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

const playbackApp = (store = new TokenStore()): ReturnType<typeof Fastify> => {
  const app = Fastify({ logger: false })
  apps.push(app)
  registerPlaybackRoutes(app, {
    tokenStore: store,
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

  it('prefers a completed local download after the original provider fails', async() => {
    const requestSource = vi.fn().mockRejectedValue(new Error('get music url failed'))
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
    expect(requestSource).toHaveBeenCalledOnce()
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
    writeFileSync(path.join(root, 'audio', 'fixture.mp3'), bytes)
    writeFileSync(path.join(root, 'audio', 'empty.mp3'), '')
    const registry = new LibraryScanner(root, () => [path.join(root, 'audio')])
    const restartedRegistry = new LibraryScanner(root, () => [path.join(root, 'audio')])
    await registry.refresh()
    await restartedRegistry.refresh()
    const app = Fastify()
    apps.push(app)
    registerLibraryRoutes(app, registry)

    const attack = await app.inject({ method: 'GET', url: '/api/v1/library/tracks/attacker-chosen-id/stream' })
    const entry = registry.list().find(item => item.size === bytes.length)!
    expect(restartedRegistry.list().find(item => item.size === bytes.length)?.id).toBe(entry.id)
    const listing = await app.inject({ method: 'GET', url: '/api/v1/library/tracks' })
    const safe = await app.inject({ method: 'GET', url: `/api/v1/library/tracks/${entry.id}/stream` })
    const open = await app.inject({ method: 'GET', url: `/api/v1/library/tracks/${entry.id}/stream`, headers: { range: 'bytes=120-' } })
    const suffix = await app.inject({ method: 'GET', url: `/api/v1/library/tracks/${entry.id}/stream`, headers: { range: 'bytes=-8' } })
    const zeroSuffix = await app.inject({ method: 'GET', url: `/api/v1/library/tracks/${entry.id}/stream`, headers: { range: 'bytes=-0' } })
    const empty = registry.list().find(item => item.size === 0)!
    const emptyRange = await app.inject({ method: 'HEAD', url: `/api/v1/library/tracks/${empty.id}/stream`, headers: { range: 'bytes=0-' } })

    expect(attack.statusCode).toBe(404)
    expect(listing.json().data).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: entry.id, size: bytes.length }),
      expect.objectContaining({ id: empty.id, size: 0 }),
    ]))
    expect(listing.body).not.toContain(root)
    expect(safe.statusCode).toBe(200)
    expect(safe.rawPayload).toEqual(bytes)
    expect(open.statusCode).toBe(206)
    expect(open.rawPayload).toEqual(bytes.subarray(120))
    expect(suffix.statusCode).toBe(206)
    expect(suffix.rawPayload).toEqual(bytes.subarray(120))
    expect(zeroSuffix.statusCode).toBe(416)
    expect(zeroSuffix.headers['content-range']).toBe('bytes */128')
    expect(emptyRange.statusCode).toBe(416)
    expect(emptyRange.headers['content-range']).toBe('bytes */0')
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
      resolveTrack: async() => ({ url: '/api/v1/streams/opaque-token', quality: '128k' as TuneFlow.Quality, expiresAt: 123 }),
    })

    const invalid = await app.inject({ method: 'POST', url: '/api/v1/playback/tracks/resolve', payload: { source: '', quality: '128k', info: {} } })
    const resolved = await app.inject({ method: 'POST', url: '/api/v1/playback/tracks/resolve', payload: { source: 'kw', quality: '128k', info: {} } })

    expect(invalid.statusCode).toBe(400)
    expect(resolved.json()).toEqual({ data: { url: '/api/v1/streams/opaque-token', quality: '128k', expiresAt: 123 } })
    expect(resolved.body).not.toContain('http://')
    expect(resolved.body).not.toContain('https://')
  })

  it('blocks mapped IPv4 and IPv6 private address variants', () => {
    expect(['::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:169.254.1.1', 'fc00::1', 'fd12::1'].every(isBlockedAddress)).toBe(true)
    expect(isBlockedAddress('2001:4860:4860::8888')).toBe(false)
    expect(isBlockedAddress('8.8.8.8')).toBe(false)
  })
})
