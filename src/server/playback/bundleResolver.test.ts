import { describe, expect, it, vi } from 'vitest'
import type { SourcesService } from '../routes/sources'
import { SourceServiceError } from '../sources/types'
import { PlaybackResourceStore } from './resourceStore'
import { PlaybackBundleResolver } from './bundleResolver'
import { PlaybackResolver } from './resolver'
import { TokenStore } from './tokenStore'

const input = {
  source: 'wy',
  quality: '128k' as TuneFlow.Quality,
  info: { id: 'track-1', name: 'Song', singer: 'Singer', source: 'wy' },
}

const sourceService = (values: Record<string, Record<string, unknown>>): SourcesService => {
  const ids = Object.keys(values)
  return {
    snapshot: (provider: string, action: string) => ids
      .filter(id => values[id][`${provider}:${action}`] !== undefined)
      .map(id => ({ id, priority: ids.indexOf(id) })),
    requestSource: async(id: string, request: { source: string, action: string }) => {
      const value = values[id][`${request.source}:${request.action}`]
      if (value instanceof Error) throw value
      return value
    },
  } as unknown as SourcesService
}

const mediaClient = {
  probeAudio: vi.fn(async() => {}),
  fetchArtwork: vi.fn(async() => ({ bytes: Uint8Array.of(1, 2, 3), mimeType: 'image/png' })),
}

describe('playback resource bundle resolver', () => {
  it('keeps completed audio when optional enrichment exceeds its budget', async() => {
    const sources = sourceService({
      a: {
        'wy:musicUrl': { url: 'https://a.test/audio' },
        'wy:lyric': { lyric: '[00:00]late' },
      },
    })
    vi.spyOn(sources, 'requestSource').mockImplementation(async(id, request, signal) => {
      if (request.action === 'musicUrl') return { url: 'https://a.test/audio' }
      await new Promise<void>((_resolve, reject) => {
        signal?.addEventListener('abort', () => { reject(new SourceServiceError('SOURCE_CANCELLED', 'budget', 'caller')) }, { once: true })
      })
      return { lyric: '[00:00]late' }
    })
    const resolver = new PlaybackBundleResolver({
      sources,
      mediaClient: mediaClient as never,
      resourceStore: new PlaybackResourceStore(),
      hedgeDelayMs: 0,
      budgetMs: 5,
    })

    await expect(resolver.resolve(input)).resolves.toMatchObject({
      audioKind: 'online',
      completeness: 'audio-only',
      sourceIds: { audio: 'a' },
    })
  })

  it('does not wait for a lower-priority hanging audio candidate after the preferred source is complete', async() => {
    const sources = sourceService({
      a: {
        'wy:musicUrl': { url: 'https://a.test/audio' },
        'wy:lyric': { lyric: '[00:00]a' },
        'wy:pic': 'https://a.test/picture',
      },
      b: { 'wy:musicUrl': { url: 'https://b.test/audio' } },
    })
    vi.spyOn(sources, 'requestSource').mockImplementation(async(id, request, signal) => {
      if (id === 'b' && request.action === 'musicUrl') {
        return await new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => { reject(new SourceServiceError('SOURCE_CANCELLED', 'superseded', 'caller')) }, { once: true })
        })
      }
      const actionValues: Record<string, unknown> = {
        musicUrl: { url: 'https://a.test/audio' },
        lyric: { lyric: '[00:00]a' },
        pic: 'https://a.test/picture',
      }
      return actionValues[request.action]
    })
    const resolver = new PlaybackBundleResolver({
      sources,
      mediaClient: mediaClient as never,
      resourceStore: new PlaybackResourceStore(),
      hedgeDelayMs: 0,
      budgetMs: 100,
    })

    const result = await Promise.race([
      resolver.resolve(input),
      new Promise<never>((_resolve, reject) => { setTimeout(() => { reject(new Error('resolver remained blocked')) }, 50) }),
    ])

    expect(result).toMatchObject({ completeness: 'complete', sourceIds: { audio: 'a', lyrics: 'a', picture: 'a' } })
  })

  it('returns published audio at the enrichment deadline without waiting for another hanging audio source', async() => {
    const sources = sourceService({
      a: { 'wy:musicUrl': { url: 'https://a.test/audio' }, 'wy:lyric': { lyric: '[00:00]late' } },
      b: { 'wy:musicUrl': { url: 'https://b.test/audio' } },
    })
    vi.spyOn(sources, 'requestSource').mockImplementation(async(id, request, signal) => {
      if (id === 'a' && request.action === 'musicUrl') return { url: 'https://a.test/audio' }
      return await new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => { reject(new SourceServiceError('SOURCE_CANCELLED', 'budget', 'caller')) }, { once: true })
      })
    })
    const resolver = new PlaybackBundleResolver({
      sources,
      mediaClient: mediaClient as never,
      resourceStore: new PlaybackResourceStore(),
      hedgeDelayMs: 0,
      budgetMs: 5,
    })

    const result = await Promise.race([
      resolver.resolve(input),
      new Promise<never>((_resolve, reject) => { setTimeout(() => { reject(new Error('published audio remained blocked')) }, 50) }),
    ])

    expect(result).toMatchObject({ completeness: 'audio-only', sourceIds: { audio: 'a' } })
  })

  it('does not bypass a higher-priority terminal failure for a lower complete source', async() => {
    const sources = sourceService({
      a: { 'wy:musicUrl': new SourceServiceError('SOURCE_PROTOCOL_ERROR', 'invalid script output', 'script') },
      b: {
        'wy:musicUrl': { url: 'https://b.test/audio' },
        'wy:lyric': { lyric: '[00:00]b' },
        'wy:pic': 'https://b.test/picture',
      },
    })
    const resolver = new PlaybackBundleResolver({
      sources,
      mediaClient: mediaClient as never,
      resourceStore: new PlaybackResourceStore(),
      hedgeDelayMs: 0,
      budgetMs: 10,
    })

    await expect(resolver.resolve(input)).rejects.toMatchObject({ code: 'SOURCE_PROTOCOL_ERROR', origin: 'script' })
  })

  it('preserves an audio-stage terminal failure that arrives after the enrichment deadline', async() => {
    const sources = sourceService({
      a: { 'wy:musicUrl': { url: 'https://a.test/audio' } },
      b: { 'wy:musicUrl': { url: 'https://b.test/audio' } },
    })
    vi.spyOn(sources, 'requestSource').mockImplementation(async(id) => {
      await new Promise(resolve => { setTimeout(resolve, id === 'a' ? 10 : 15) })
      if (id === 'a') throw new SourceServiceError('SOURCE_PROTOCOL_ERROR', 'late invalid output', 'script')
      return { url: 'https://b.test/audio' }
    })
    const resolver = new PlaybackBundleResolver({
      sources,
      mediaClient: mediaClient as never,
      resourceStore: new PlaybackResourceStore(),
      hedgeDelayMs: 0,
      budgetMs: 5,
    })

    await expect(resolver.resolve(input)).rejects.toMatchObject({ code: 'SOURCE_PROTOCOL_ERROR', origin: 'script' })
  })

  it('bounds hanging built-in enrichment with the same resolve deadline', async() => {
    const resolver = new PlaybackBundleResolver({
      sources: sourceService({}),
      mediaClient: mediaClient as never,
      resourceStore: new PlaybackResourceStore(),
      findLocal: () => ({ streamUrl: '/api/v1/library/tracks/local/stream' }),
      getBuiltinLyrics: async() => await new Promise<never>(() => {}),
      budgetMs: 5,
      hedgeDelayMs: 0,
    })

    const result = await Promise.race([
      resolver.resolve(input),
      new Promise<never>((_resolve, reject) => { setTimeout(() => { reject(new Error('built-in enrichment remained blocked')) }, 50) }),
    ])

    expect(result).toMatchObject({ audioKind: 'local', completeness: 'audio-only' })
  })

  it('never lets optional online enrichment block local audio', async() => {
    const sources = sourceService({
      a: { 'wy:lyric': new SourceServiceError('SOURCE_PROTOCOL_ERROR', 'broken script', 'script') },
    })
    const resolver = new PlaybackBundleResolver({
      sources,
      mediaClient: mediaClient as never,
      resourceStore: new PlaybackResourceStore(),
      findLocal: () => ({ streamUrl: '/api/v1/library/tracks/local/stream' }),
      getBuiltinPicture: async() => { throw new Error('offline') },
      hedgeDelayMs: 0,
      budgetMs: 5,
    })

    await expect(resolver.resolve(input)).resolves.toMatchObject({
      audioKind: 'local',
      completeness: 'audio-only',
      sourceIds: { audio: 'local' },
    })
  })

  it('keeps usable online audio when optional resources are malformed', async() => {
    const sources = sourceService({
      a: {
        'wy:musicUrl': { url: 'https://a.test/audio' },
        'wy:lyric': new SourceServiceError('SOURCE_PROTOCOL_ERROR', 'broken optional resource', 'script'),
      },
    })
    const resolver = new PlaybackBundleResolver({
      sources,
      mediaClient: mediaClient as never,
      resourceStore: new PlaybackResourceStore(),
      hedgeDelayMs: 0,
    })

    await expect(resolver.resolve(input)).resolves.toMatchObject({
      audioKind: 'online',
      completeness: 'audio-only',
      sourceIds: { audio: 'a' },
    })
  })

  it('reports safe structured attempts when every audio source is exhausted', async() => {
    const sources = sourceService({
      a: { 'wy:musicUrl': new SourceServiceError('SOURCE_TIMEOUT', 'private upstream detail', 'service-network') },
      b: { 'wy:musicUrl': new SourceServiceError('SOURCE_NETWORK_ERROR', 'private host detail', 'service-network') },
    })
    const resolver = new PlaybackBundleResolver({
      sources,
      mediaClient: mediaClient as never,
      resourceStore: new PlaybackResourceStore(),
      hedgeDelayMs: 0,
    })

    await expect(resolver.resolve(input)).rejects.toMatchObject({
      code: 'SOURCE_ALL_UNAVAILABLE',
      details: {
        attempts: [
          expect.objectContaining({ sourceId: 'a', code: 'SOURCE_TIMEOUT' }),
          expect.objectContaining({ sourceId: 'b', code: 'SOURCE_NETWORK_ERROR' }),
        ],
      },
    })
  })

  it('returns local audio and resources without requesting online audio', async() => {
    const sources = sourceService({ a: { 'wy:musicUrl': { url: 'https://a.test/audio' } } })
    const requestSource = vi.spyOn(sources, 'requestSource')
    const resolver = new PlaybackBundleResolver({
      sources,
      mediaClient: mediaClient as never,
      resourceStore: new PlaybackResourceStore(),
      findLocal: async() => ({
        streamUrl: `/api/v1/library/tracks/${'a'.repeat(64)}/stream`,
        lyricsUrl: `/api/v1/library/tracks/${'a'.repeat(64)}/lyrics`,
        pictureUrl: `/api/v1/library/tracks/${'a'.repeat(64)}/picture`,
      }),
    })

    const bundle = await resolver.resolve(input)

    expect(bundle).toMatchObject({ audioKind: 'local', completeness: 'complete', sourceIds: { audio: 'local', lyrics: 'local', picture: 'local' } })
    expect(requestSource).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'musicUrl' }), expect.anything())
  })

  it('prefers the highest-priority complete same-source bundle', async() => {
    const attempts: unknown[] = []
    const sources = sourceService({
      a: {
        'wy:musicUrl': { url: 'https://a.test/audio' },
        'wy:lyric': { lyric: '[00:00]a' },
      },
      b: {
        'wy:musicUrl': { url: 'https://b.test/audio' },
        'wy:lyric': { lyric: '[00:00]b' },
        'wy:pic': 'https://b.test/picture',
      },
    })
    const resolver = new PlaybackBundleResolver({
      sources,
      mediaClient: mediaClient as never,
      resourceStore: new PlaybackResourceStore(),
      hedgeDelayMs: 0,
      onAttempt: attempt => { attempts.push(attempt) },
    })

    const bundle = await resolver.resolve(input)

    expect(bundle.sourceIds).toEqual({ audio: 'b', lyrics: 'b', picture: 'b' })
    expect(bundle.completeness).toBe('complete')
    expect(bundle.streamCandidates.map(candidate => candidate.sourceId)).toEqual(['b', 'a'])
    expect(bundle.resources.pictureUrl).toMatch(/^\/api\/v1\/playback\/resources\/[a-f0-9]{64}\/picture$/)
    expect(attempts).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceId: 'a', priority: 0, action: 'bundle', code: 'OK' }),
      expect.objectContaining({ sourceId: 'b', priority: 1, action: 'bundle', code: 'OK' }),
    ]))
    expect(JSON.stringify(attempts)).not.toContain('https://')
  })

  it('combines the best validated components when no complete source exists', async() => {
    const sources = sourceService({
      a: { 'wy:musicUrl': { url: 'https://a.test/audio' } },
      b: { 'wy:lyric': { lyric: '[00:00]b' } },
      c: { 'wy:pic': 'https://c.test/picture' },
    })
    const resolver = new PlaybackBundleResolver({
      sources,
      mediaClient: mediaClient as never,
      resourceStore: new PlaybackResourceStore(),
      hedgeDelayMs: 0,
    })

    const bundle = await resolver.resolve(input)

    expect(bundle.sourceIds).toEqual({ audio: 'a', lyrics: 'b', picture: 'c' })
    expect(bundle.completeness).toBe('mixed')
  })

  it('fully exhausts the original track before evaluating alternatives', async() => {
    const calls: string[] = []
    const sources = sourceService({
      a: {
        'wy:musicUrl': new Error('unavailable'),
        'tx:musicUrl': { url: 'https://a.test/alternative' },
      },
    })
    vi.spyOn(sources, 'requestSource').mockImplementation(async(id, request) => {
      calls.push(request.source)
      if (request.source === 'wy') throw new SourceServiceError('SOURCE_NETWORK_ERROR', 'offline', 'service-network')
      return { url: 'https://a.test/alternative' }
    })
    const resolver = new PlaybackBundleResolver({
      sources,
      mediaClient: mediaClient as never,
      resourceStore: new PlaybackResourceStore(),
      findAlternatives: async() => [{ id: 'alt', source: 'tx', name: 'Song', singer: 'Singer' }],
      hedgeDelayMs: 0,
    })

    await expect(resolver.resolve(input)).resolves.toMatchObject({ sourceIds: { audio: 'a' } })
    expect(calls).toEqual(['wy', 'tx'])
  })

  it('publishes only opaque streams and safe bundle resources', async() => {
    const sources = sourceService({
      a: {
        'wy:musicUrl': { url: 'https://secret.test/audio', headers: { authorization: 'secret' } },
        'wy:lyric': { lyric: '[00:00]safe lyric' },
        'wy:pic': 'https://secret.test/picture',
      },
    })
    const bundleResolver = new PlaybackBundleResolver({
      sources,
      mediaClient: mediaClient as never,
      resourceStore: new PlaybackResourceStore(),
      hedgeDelayMs: 0,
    })
    const tokens = new TokenStore()
    const resolver = new PlaybackResolver(sources, tokens, undefined, undefined, bundleResolver)

    const resolved = await resolver.resolveTrack(input)

    expect(resolved).toMatchObject({
      url: expect.stringMatching(/^\/api\/v1\/streams\/[a-f0-9]{64}$/),
      resources: {
        lyrics: { lyric: '[00:00]safe lyric' },
        pictureUrl: expect.stringMatching(/^\/api\/v1\/playback\/resources\/[a-f0-9]{64}\/picture$/),
      },
      completeness: 'complete',
    })
    expect(JSON.stringify(resolved)).not.toContain('secret.test')
    const token = resolved.url.split('/').pop()!
    expect(tokens.get(token)?.candidates).toEqual([
      { sourceId: 'a', url: 'https://secret.test/audio', headers: { authorization: 'secret' } },
    ])
  })
})
