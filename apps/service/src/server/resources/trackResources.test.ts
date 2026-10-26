import { describe, expect, it, vi } from 'vitest'
import { SourceServiceError } from '../sources/types'
import { TrackResourceService } from './trackResources'

const track = {
  id: 'track-1',
  name: 'Fixture',
  singer: 'Artist',
  source: 'tx',
  meta: { songId: 'track-1' },
}

const sources = (requestSource: (id: string) => Promise<unknown>) => ({
  snapshot: () => [{ id: 'a', priority: 0 }, { id: 'b', priority: 1 }],
  requestSource,
})

const mediaClient = {
  fetchArtwork: vi.fn(async() => ({ bytes: Uint8Array.of(1, 2, 3), mimeType: 'image/png' })),
}

describe('track resource service', () => {
  it('continues to the next lyric source after a source-local protocol failure', async() => {
    const requestSource = vi.fn(async(id: string) => {
      if (id === 'a') throw new SourceServiceError('SOURCE_PROTOCOL_ERROR', 'broken script', 'script')
      return { lyric: '[00:01.00]backup' }
    })
    const service = new TrackResourceService({ sources: sources(requestSource) as never, mediaClient: mediaClient as never })

    await expect(service.resolveLyrics('tx', track)).resolves.toEqual({ lyric: '[00:01.00]backup' })
    expect(requestSource.mock.calls.map(call => call[0])).toEqual(['a', 'b'])
  })

  it('uses the built-in lyric provider after every custom source fails', async() => {
    const requestSource = vi.fn(async() => { throw new SourceServiceError('SOURCE_PROTOCOL_ERROR', 'broken', 'protocol') })
    const getBuiltinLyrics = vi.fn(async() => ({ lyric: '[00:01.00]builtin' }))
    const service = new TrackResourceService({
      sources: sources(requestSource) as never,
      mediaClient: mediaClient as never,
      getBuiltinLyrics,
    })

    await expect(service.resolveLyrics('tx', track)).resolves.toEqual({ lyric: '[00:01.00]builtin' })
    expect(requestSource).toHaveBeenCalledTimes(2)
    expect(getBuiltinLyrics).toHaveBeenCalledTimes(1)
  })

  it('searches a matching alternative provider after the original lyric chain is exhausted', async() => {
    const calls: string[] = []
    const requestSource = vi.fn(async(_id: string, request: { source: string }) => {
      calls.push(`script:${request.source}`)
      throw new SourceServiceError('SOURCE_PROTOCOL_ERROR', 'missing lyric', 'script')
    })
    const getBuiltinLyrics = vi.fn(async(provider: string) => {
      calls.push(`builtin:${provider}`)
      if (provider === 'wy') return { lyric: '[00:01.00]alternative' }
      throw new Error('missing lyric')
    })
    const findAlternatives = vi.fn(async() => [{
      id: 'alternative-1',
      name: 'Fixture',
      singer: 'Artist',
      source: 'wy',
      meta: { songId: 'alternative-1' },
    }])
    const providerSources = {
      snapshot: () => [{ id: 'a', priority: 0 }],
      requestSource,
    }
    const service = new TrackResourceService({
      sources: providerSources as never,
      mediaClient: mediaClient as never,
      getBuiltinLyrics,
      findAlternatives,
    })

    await expect(service.resolveLyrics('tx', track)).resolves.toEqual({ lyric: '[00:01.00]alternative' })
    expect(calls).toEqual(['script:tx', 'builtin:tx', 'script:wy', 'builtin:wy'])
    expect(findAlternatives).toHaveBeenCalledTimes(1)
  })

  it('searches alternative providers for a local track without cloud identity', async() => {
    const localTrack = {
      id: 'local-file',
      name: 'Fixture',
      singer: 'Artist',
      interval: '03:00',
      source: 'local',
      meta: { songId: 'local-file' },
    }
    const findAlternatives = vi.fn(async() => [{
      id: 'online-match',
      name: 'Fixture',
      singer: 'Artist',
      interval: '03:00',
      source: 'wy',
      meta: { songId: 'online-match' },
    }])
    const emptySources = { snapshot: () => [], requestSource: vi.fn() }
    const service = new TrackResourceService({
      sources: emptySources as never,
      mediaClient: mediaClient as never,
      getBuiltinLyrics: async(provider) => {
        if (provider === 'wy') return { lyric: '[00:01.00]online match' }
        throw new Error('missing lyric')
      },
      findAlternatives,
    })

    await expect(service.resolveLyrics('local', localTrack)).resolves.toEqual({ lyric: '[00:01.00]online match' })
    expect(findAlternatives).toHaveBeenCalledWith(localTrack)
  })

  it('deduplicates and bounds alternative lyric candidates', async() => {
    const providers: string[] = []
    const emptySources = { snapshot: () => [], requestSource: vi.fn() }
    const service = new TrackResourceService({
      sources: emptySources as never,
      mediaClient: mediaClient as never,
      getBuiltinLyrics: async(provider) => {
        providers.push(provider)
        throw new Error('missing lyric')
      },
      findAlternatives: async() => [
        { id: 'same-provider', source: 'tx' },
        { id: 'wy-outer-1', source: 'wy', meta: { songId: 'wy-native' } },
        { id: 'wy-outer-2', source: 'wy', meta: { songId: 'wy-native' } },
        { id: 'kg-1', source: 'kg' },
        { id: 'mg-1', source: 'mg' },
        { id: 'kw-1', source: 'kw' },
        { id: 'q-1', source: 'q' },
        { id: 'xm-1', source: 'xm' },
        { id: 'extra-1', source: 'extra' },
      ],
    })

    await expect(service.resolveLyrics('tx', track)).rejects.toMatchObject({ code: 'SOURCE_ALL_UNAVAILABLE' })
    expect(providers).toEqual(['tx', 'wy', 'kg', 'mg', 'kw', 'q', 'xm'])
  })

  it('caches resources by provider-native identity across different outer ids', async() => {
    const requestSource = vi.fn(async() => ({ lyric: '[00:01.00]cached native identity' }))
    const service = new TrackResourceService({ sources: sources(requestSource) as never, mediaClient: mediaClient as never })
    const first = { ...track, id: 'outer-1', meta: { songId: 'native-track' } }
    const second = { ...track, id: 'outer-2', meta: { songId: 'native-track' } }

    await service.resolveLyrics('tx', first)
    await expect(service.resolveLyrics('tx', second)).resolves.toEqual({ lyric: '[00:01.00]cached native identity' })

    expect(requestSource).toHaveBeenCalledTimes(1)
  })

  it('coalesces concurrent lyric lookups for the same track identity', async() => {
    let release: ((value: { lyric: string }) => void) | undefined
    const pending = new Promise<{ lyric: string }>(resolve => { release = resolve })
    const requestSource = vi.fn(async() => await pending)
    const service = new TrackResourceService({ sources: sources(requestSource) as never, mediaClient: mediaClient as never })

    const first = service.resolveLyrics('tx', track)
    const second = service.resolveLyrics('tx', { ...track })
    await Promise.resolve()
    release?.({ lyric: '[00:01.00]shared' })

    await expect(first).resolves.toEqual({ lyric: '[00:01.00]shared' })
    await expect(second).resolves.toEqual({ lyric: '[00:01.00]shared' })
    expect(requestSource).toHaveBeenCalledTimes(1)
  })

  it('lets one concurrent lyric caller cancel without cancelling the shared lookup', async() => {
    let release: ((value: { lyric: string }) => void) | undefined
    const pending = new Promise<{ lyric: string }>(resolve => { release = resolve })
    const requestSource = vi.fn(async() => await pending)
    const service = new TrackResourceService({ sources: sources(requestSource) as never, mediaClient: mediaClient as never })
    const controller = new AbortController()

    const cancelledCaller = service.resolveLyrics('tx', track, controller.signal)
    const remainingCaller = service.resolveLyrics('tx', track)
    controller.abort()
    release?.({ lyric: '[00:01.00]shared' })

    await expect(cancelledCaller).rejects.toMatchObject({ code: 'SOURCE_CANCELLED', origin: 'caller' })
    await expect(remainingCaller).resolves.toEqual({ lyric: '[00:01.00]shared' })
    expect(requestSource).toHaveBeenCalledTimes(1)
  })

  it('coalesces concurrent picture lookups independently from lyrics', async() => {
    let release: ((value: { bytes: Uint8Array, mimeType: string }) => void) | undefined
    const pending = new Promise<{ bytes: Uint8Array, mimeType: string }>(resolve => { release = resolve })
    const fetchArtwork = vi.fn(async() => await pending)
    const emptySources = { snapshot: () => [], requestSource: vi.fn() }
    const pictureClient = { fetchArtwork }
    const service = new TrackResourceService({
      sources: emptySources as never,
      mediaClient: pictureClient as never,
      getBuiltinPicture: async() => 'https://example.test/cover.png',
    })

    const first = service.resolvePicture('tx', track)
    const second = service.resolvePicture('tx', { ...track })
    await Promise.resolve()
    release?.({ bytes: Uint8Array.of(4, 5, 6), mimeType: 'image/png' })

    await expect(first).resolves.toMatchObject({ mimeType: 'image/png' })
    await expect(second).resolves.toMatchObject({ mimeType: 'image/png' })
    expect(fetchArtwork).toHaveBeenCalledTimes(1)
  })

  it('bounds the shared lookup independently of caller cancellation', async() => {
    const emptySources = { snapshot: () => [], requestSource: vi.fn() }
    const service = new TrackResourceService({
      sources: emptySources as never,
      mediaClient: mediaClient as never,
      getBuiltinLyrics: async() => { throw new Error('missing lyric') },
      findAlternatives: async() => await new Promise<never>(() => {}),
      lookupTimeoutMs: 5,
    })

    await expect(service.resolveLyrics('tx', track)).rejects.toMatchObject({
      code: 'SOURCE_ALL_UNAVAILABLE',
      origin: 'service-network',
    })
  })

  it('cancels lyrics lookup while alternative-provider search is pending', async() => {
    const controller = new AbortController()
    const emptySources = { snapshot: () => [], requestSource: vi.fn() }
    const service = new TrackResourceService({
      sources: emptySources as never,
      mediaClient: mediaClient as never,
      getBuiltinLyrics: async() => { throw new Error('missing lyric') },
      findAlternatives: async() => await new Promise<never>(() => {}),
    })

    const pending = service.resolveLyrics('tx', track, controller.signal)
    controller.abort()

    await expect(Promise.race([
      pending,
      new Promise<never>((_resolve, reject) => { setTimeout(() => { reject(new Error('alternative search ignored cancellation')) }, 50) }),
    ])).rejects.toMatchObject({ code: 'SOURCE_CANCELLED', origin: 'caller' })
  })

  it('cancels lyrics lookup while the built-in provider is pending', async() => {
    const controller = new AbortController()
    const emptySources = { snapshot: () => [], requestSource: vi.fn() }
    const service = new TrackResourceService({
      sources: emptySources as never,
      mediaClient: mediaClient as never,
      getBuiltinLyrics: async() => await new Promise<never>(() => {}),
    })

    const pending = service.resolveLyrics('tx', track, controller.signal)
    controller.abort()

    await expect(Promise.race([
      pending,
      new Promise<never>((_resolve, reject) => { setTimeout(() => { reject(new Error('built-in provider ignored cancellation')) }, 50) }),
    ])).rejects.toMatchObject({ code: 'SOURCE_CANCELLED', origin: 'caller' })
  })

  it('uses a matching alternative provider when the original picture chain is exhausted', async() => {
    const fetchArtwork = vi.fn(async() => ({ bytes: Uint8Array.of(7, 8, 9), mimeType: 'image/png' }))
    const getBuiltinPicture = vi.fn(async(provider: string) => {
      if (provider === 'wy') return 'https://alternative.test/cover.png'
      throw new Error('missing picture')
    })
    const emptySources = { snapshot: () => [], requestSource: vi.fn() }
    const pictureClient = { fetchArtwork }
    const service = new TrackResourceService({
      sources: emptySources as never,
      mediaClient: pictureClient as never,
      getBuiltinPicture,
      findAlternatives: async() => [{
        id: 'alternative-1',
        name: 'Fixture',
        singer: 'Artist',
        source: 'wy',
        meta: { songId: 'alternative-1' },
      }],
    })

    await expect(service.resolvePicture('tx', track)).resolves.toEqual({
      bytes: Uint8Array.of(7, 8, 9),
      mimeType: 'image/png',
    })
  })

  it('keeps safety failures terminal', async() => {
    const requestSource = vi.fn(async() => { throw new SourceServiceError('SOURCE_TARGET_BLOCKED', 'blocked', 'safety') })
    const getBuiltinLyrics = vi.fn(async() => ({ lyric: '[00:01.00]must not run' }))
    const service = new TrackResourceService({
      sources: sources(requestSource) as never,
      mediaClient: mediaClient as never,
      getBuiltinLyrics,
    })

    await expect(service.resolveLyrics('tx', track)).rejects.toMatchObject({ origin: 'safety' })
    expect(requestSource).toHaveBeenCalledTimes(1)
    expect(getBuiltinLyrics).not.toHaveBeenCalled()
  })

  it('caches validated lyrics before notifying subscribers', async() => {
    const requestSource = vi.fn(async() => ({ lyric: '[00:01.00]cached' }))
    const service = new TrackResourceService({ sources: sources(requestSource) as never, mediaClient: mediaClient as never })
    let visibleAtNotification: string | undefined
    service.subscribe(event => {
      visibleAtNotification = service.cached(event.identity)?.lyrics?.lyric
    })

    await service.resolveLyrics('tx', track)
    await expect(service.resolveLyrics('tx', track)).resolves.toEqual({ lyric: '[00:01.00]cached' })

    expect(visibleAtNotification).toBe('[00:01.00]cached')
    expect(requestSource).toHaveBeenCalledTimes(1)
  })
})
