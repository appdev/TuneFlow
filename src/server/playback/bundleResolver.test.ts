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
  it('starts one source audio, lyric, and picture work concurrently', async() => {
    const sources = sourceService({
      a: {
        'wy:musicUrl': { url: 'https://a.test/audio' },
        'wy:lyric': { lyric: '[00:00]a lyric' },
        'wy:pic': 'https://a.test/picture',
      },
    })
    const started = new Set<string>()
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const actionValues: Record<string, unknown> = {
      musicUrl: { url: 'https://a.test/audio' },
      lyric: { lyric: '[00:00]a lyric' },
      pic: 'https://a.test/picture',
    }
    vi.spyOn(sources, 'requestSource').mockImplementation(async(_id, request) => {
      started.add(request.action)
      if (started.size === 3) release()
      await gate
      return actionValues[request.action]
    })
    const onResourcesAvailable = vi.fn()
    const resolver = new PlaybackBundleResolver({
      sources,
      mediaClient: mediaClient as never,
      resourceStore: new PlaybackResourceStore(),
      hedgeDelayMs: 0,
      onResourcesAvailable,
    })

    const bundle = await resolver.resolve(input)

    expect([...started].sort()).toEqual(['lyric', 'musicUrl', 'pic'])
    expect(onResourcesAvailable).toHaveBeenCalledWith('wy', expect.objectContaining(input.info), bundle.resources)
  })

  it('binds validated resources to each download audio candidate', async() => {
    const sources = sourceService({
      a: {
        'wy:musicUrl': { url: 'https://a.test/audio' },
        'wy:lyric': { lyric: '[00:00]a lyric' },
        'wy:pic': 'https://a.test/picture',
      },
      b: {
        'wy:musicUrl': { url: 'https://b.test/audio' },
        'wy:lyric': { lyric: '[00:00]b lyric' },
        'wy:pic': 'https://b.test/picture',
      },
    })
    const resolver = new PlaybackBundleResolver({
      sources,
      mediaClient: mediaClient as never,
      resourceStore: new PlaybackResourceStore(),
      hedgeDelayMs: 0,
    })

    const bundle = await resolver.resolve(input)

    expect(bundle.downloadCandidates?.map(candidate => ({
      sourceId: candidate.sourceId,
      lyric: candidate.resources?.lyrics?.lyric,
      sourceIds: candidate.sourceIds,
      completeness: candidate.completeness,
    }))).toEqual([
      { sourceId: 'a', lyric: '[00:00]a lyric', sourceIds: { audio: 'a', lyrics: 'a', picture: 'a' }, completeness: 'complete' },
      { sourceId: 'b', lyric: '[00:00]b lyric', sourceIds: { audio: 'b', lyrics: 'b', picture: 'b' }, completeness: 'complete' },
    ])
  })

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

  it('does not let successful higher-priority audio hide a lower-priority safety failure', async() => {
    const resolver = new PlaybackBundleResolver({
      sources: sourceService({
        audio: { 'wy:musicUrl': { url: 'https://audio.test/stream' } },
        enrichment: { 'wy:lyric': new SourceServiceError('SOURCE_TARGET_BLOCKED', 'blocked target', 'safety') },
      }),
      mediaClient: mediaClient as never,
      resourceStore: new PlaybackResourceStore(),
      hedgeDelayMs: 0,
    })

    await expect(resolver.resolve(input)).rejects.toMatchObject({
      code: 'SOURCE_TARGET_BLOCKED',
      origin: 'safety',
    })
  })

  it('does not let the resource-only deadline hide a recorded safety failure', async() => {
    const sources = sourceService({
      blocked: { 'wy:lyric': new SourceServiceError('SOURCE_TARGET_BLOCKED', 'blocked target', 'safety') },
      hanging: { 'wy:pic': 'https://hanging.test/picture' },
    })
    vi.spyOn(sources, 'requestSource').mockImplementation(async(id, request, signal) => {
      if (id === 'blocked') throw new SourceServiceError('SOURCE_TARGET_BLOCKED', 'blocked target', 'safety')
      return await new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => { reject(new SourceServiceError('SOURCE_CANCELLED', 'budget', 'caller')) }, { once: true })
      })
    })
    const resolver = new PlaybackBundleResolver({
      sources,
      mediaClient: mediaClient as never,
      resourceStore: new PlaybackResourceStore(),
      findLocal: () => ({ streamUrl: '/api/v1/library/tracks/local/stream' }),
      hedgeDelayMs: 0,
      budgetMs: 5,
    })

    await expect(resolver.resolve(input)).rejects.toMatchObject({
      code: 'SOURCE_TARGET_BLOCKED',
      origin: 'safety',
    })
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

  it('backfills local audio resources from an alternative provider without requesting alternative audio', async() => {
    const sources = sourceService({
      alternative: {
        'tx:lyric': { lyric: '[00:01.00]alternative lyric' },
        'tx:pic': 'https://alternative.test/picture',
      },
    })
    const requests: Array<{ provider: string, action: string }> = []
    const originalRequest = sources.requestSource.bind(sources)
    vi.spyOn(sources, 'requestSource').mockImplementation(async(id, request, signal) => {
      requests.push({ provider: request.source, action: request.action })
      return await originalRequest(id, request, signal)
    })
    const resolver = new PlaybackBundleResolver({
      sources,
      mediaClient: mediaClient as never,
      resourceStore: new PlaybackResourceStore(),
      findLocal: () => ({ streamUrl: '/api/v1/library/tracks/local/stream' }),
      findAlternatives: async() => [{ id: 'alternative-track', source: 'tx' }],
      hedgeDelayMs: 0,
    })

    const bundle = await resolver.resolve(input)

    expect(bundle).toMatchObject({
      audioKind: 'local',
      streamUrl: '/api/v1/library/tracks/local/stream',
      sourceIds: { audio: 'local', lyrics: 'alternative', picture: 'alternative' },
    })
    expect(requests.filter(value => value.provider === 'tx')).toEqual([
      { provider: 'tx', action: 'lyric' },
      { provider: 'tx', action: 'pic' },
    ])
    expect(requests.some(value => value.action === 'musicUrl')).toBe(false)
  })

  it('keeps safety failures terminal while enriching local audio', async() => {
    const resolver = new PlaybackBundleResolver({
      sources: sourceService({
        original: {
          'wy:lyric': new SourceServiceError('SOURCE_TARGET_BLOCKED', 'blocked target', 'safety'),
        },
      }),
      mediaClient: mediaClient as never,
      resourceStore: new PlaybackResourceStore(),
      findLocal: () => ({ streamUrl: '/api/v1/library/tracks/local/stream' }),
      hedgeDelayMs: 0,
    })

    await expect(resolver.resolve(input)).rejects.toMatchObject({
      code: 'SOURCE_TARGET_BLOCKED',
      origin: 'safety',
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

  it('backfills missing resources from an alternative provider without replacing original audio', async() => {
    const sources = sourceService({
      original: { 'wy:musicUrl': { url: 'https://original.test/audio' } },
      alternative: {
        'tx:lyric': { lyric: '[00:01.00]alternative lyric' },
        'tx:pic': 'https://alternative.test/picture',
      },
    })
    const requests: Array<{ provider: string, action: string }> = []
    const originalRequest = sources.requestSource.bind(sources)
    vi.spyOn(sources, 'requestSource').mockImplementation(async(id, request, signal) => {
      requests.push({ provider: request.source, action: request.action })
      return await originalRequest(id, request, signal)
    })
    const resolver = new PlaybackBundleResolver({
      sources,
      mediaClient: mediaClient as never,
      resourceStore: new PlaybackResourceStore(),
      findAlternatives: async() => [{ id: 'alternative-track', name: 'Song', singer: 'Singer', source: 'tx' }],
      hedgeDelayMs: 0,
    })

    const bundle = await resolver.resolve(input)

    expect(bundle.sourceIds).toEqual({ audio: 'original', lyrics: 'alternative', picture: 'alternative' })
    expect(bundle.streamCandidates.map(value => value.sourceId)).toEqual(['original'])
    expect(requests.filter(value => value.provider === 'tx')).toEqual([
      { provider: 'tx', action: 'lyric' },
      { provider: 'tx', action: 'pic' },
    ])
  })

  it('deduplicates and bounds alternative providers used for playback resource backfill', async() => {
    const builtins: string[] = []
    const resolver = new PlaybackBundleResolver({
      sources: sourceService({
        original: {
          'wy:musicUrl': { url: 'https://original.test/audio' },
          'wy:pic': 'https://original.test/picture',
        },
      }),
      mediaClient: mediaClient as never,
      resourceStore: new PlaybackResourceStore(),
      getBuiltinLyrics: async(provider) => {
        builtins.push(provider)
        throw new Error('missing lyric')
      },
      findAlternatives: async() => [
        { id: 'same-provider', source: 'wy' },
        { id: 'tx-1', source: 'tx' },
        { id: 'tx-1', source: 'tx' },
        { id: 'kg-1', source: 'kg' },
        { id: 'mg-1', source: 'mg' },
        { id: 'kw-1', source: 'kw' },
        { id: 'q-1', source: 'q' },
        { id: 'xm-1', source: 'xm' },
        { id: 'extra-1', source: 'extra' },
      ],
      hedgeDelayMs: 0,
    })

    await expect(resolver.resolve(input)).resolves.toMatchObject({ sourceIds: { audio: 'original', picture: 'original' } })
    expect(builtins).toEqual(['wy', 'tx', 'kg', 'mg', 'kw', 'q', 'xm'])
  })

  it('keeps alternative-provider safety failures terminal during resource backfill', async() => {
    const resolver = new PlaybackBundleResolver({
      sources: sourceService({
        original: {
          'wy:musicUrl': { url: 'https://original.test/audio' },
          'wy:pic': 'https://original.test/picture',
        },
        alternative: {
          'tx:lyric': new SourceServiceError('SOURCE_TARGET_BLOCKED', 'blocked target', 'safety'),
        },
      }),
      mediaClient: mediaClient as never,
      resourceStore: new PlaybackResourceStore(),
      findAlternatives: async() => [{ id: 'alternative-track', source: 'tx' }],
      hedgeDelayMs: 0,
    })

    await expect(resolver.resolve(input)).rejects.toMatchObject({
      code: 'SOURCE_TARGET_BLOCKED',
      origin: 'safety',
    })
  })

  it('keeps alternative built-in safety failures terminal during resource backfill', async() => {
    const resolver = new PlaybackBundleResolver({
      sources: sourceService({
        original: {
          'wy:musicUrl': { url: 'https://original.test/audio' },
          'wy:pic': 'https://original.test/picture',
        },
      }),
      mediaClient: mediaClient as never,
      resourceStore: new PlaybackResourceStore(),
      getBuiltinLyrics: async(provider) => {
        if (provider === 'tx') throw new SourceServiceError('SOURCE_TARGET_BLOCKED', 'blocked target', 'safety')
        return undefined
      },
      findAlternatives: async() => [{ id: 'alternative-track', source: 'tx' }],
      hedgeDelayMs: 0,
    })

    await expect(resolver.resolve(input)).rejects.toMatchObject({
      code: 'SOURCE_TARGET_BLOCKED',
      origin: 'safety',
    })
  })

  it('does not let alternative-provider search exceed the enrichment deadline', async() => {
    const resolver = new PlaybackBundleResolver({
      sources: sourceService({
        original: {
          'wy:musicUrl': { url: 'https://original.test/audio' },
          'wy:pic': 'https://original.test/picture',
        },
      }),
      mediaClient: mediaClient as never,
      resourceStore: new PlaybackResourceStore(),
      findAlternatives: async() => await new Promise<never>(() => {}),
      hedgeDelayMs: 0,
      budgetMs: 5,
    })

    const result = await Promise.race([
      resolver.resolve(input),
      new Promise<never>((_resolve, reject) => { setTimeout(() => { reject(new Error('alternative search blocked playback')) }, 50) }),
    ])

    expect(result).toMatchObject({
      sourceIds: { audio: 'original', picture: 'original' },
      completeness: 'mixed',
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

  it('falls back from failed provider artwork to the validated canonical snapshot', async() => {
    const sources = sourceService({
      a: {
        'wy:musicUrl': { url: 'https://a.test/audio' },
        'wy:lyric': { lyric: '[00:00]a' },
      },
    })
    const fetchArtwork = vi.fn(async(target: { url: string }) => {
      if (target.url === 'https://provider.test/missing.jpg') {
        throw new SourceServiceError('SOURCE_MEDIA_UNAVAILABLE', 'Artwork request returned HTTP 404', 'service-network')
      }
      if (target.url === 'https://snapshot.test/cover.jpg') {
        return { bytes: Uint8Array.of(9, 8, 7), mimeType: 'image/png' }
      }
      throw new Error(`unexpected artwork target: ${target.url}`)
    })
    const resolver = new PlaybackBundleResolver({
      sources,
      mediaClient: Object.assign({}, mediaClient, { fetchArtwork }) as never,
      resourceStore: new PlaybackResourceStore(),
      getBuiltinPicture: async() => 'https://provider.test/missing.jpg',
      hedgeDelayMs: 0,
    })

    const bundle = await resolver.resolve({
      ...input,
      info: {
        id: 'track-1',
        name: 'Song',
        singer: 'Singer',
        source: 'wy',
        meta: { songId: 'track-1', picUrl: 'https://snapshot.test/cover.jpg' },
      },
    })

    expect(fetchArtwork.mock.calls.map(([target]) => target.url)).toEqual([
      'https://provider.test/missing.jpg',
      'https://snapshot.test/cover.jpg',
    ])
    expect(bundle.sourceIds).toEqual({ audio: 'a', lyrics: 'a', picture: 'snapshot' })
    expect(bundle.resources.pictureUrl).toMatch(/^\/api\/v1\/playback\/resources\/[a-f0-9]{64}\/picture$/)
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
