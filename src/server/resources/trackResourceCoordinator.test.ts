/* eslint-disable @typescript-eslint/consistent-type-assertions */
import { describe, expect, it, vi } from 'vitest'
import { TrackResourceCoordinator } from './trackResourceCoordinator'

const musicInfo = {
  id: 'track-1',
  source: 'tx',
  name: 'Song',
  singer: 'Singer',
  interval: '00:01',
  meta: { songId: 'track-1', albumName: '', _qualitys: {} },
} as TuneFlow.Music.MusicInfoOnline

describe('TrackResourceCoordinator', () => {
  it('continues missing playback resource lookup independently of the playback request signal', async() => {
    const signals: Array<AbortSignal | undefined> = []
    const resolveLyrics = vi.fn(async(_source, _info, signal) => {
      signals.push(signal)
      return { lyric: '[00:01.00]background' }
    })
    const coordinator = new TrackResourceCoordinator({
      downloads: { attachResolvedResources: vi.fn(), publishMetadataPatch: vi.fn(() => false) } as never,
      library: { refresh: vi.fn(), findMatchingFile: vi.fn() } as never,
      libraryResources: { invalidate: vi.fn(), ensure: vi.fn() } as never,
      enricher: { enrich: vi.fn() } as never,
      resources: { resolveLyrics, resolvePicture: vi.fn() },
      getSettings: () => ({} as TuneFlow.AppSetting),
      publishEvent: vi.fn(),
      publishLibrary: vi.fn(),
    })

    coordinator.resolveMissingForPlayback('local', musicInfo, new Set(['lyrics']))
    await coordinator.waitForIdle()

    expect(resolveLyrics).toHaveBeenCalledTimes(1)
    expect(signals).toEqual([undefined])
  })

  it('resolves missing download resources without blocking and isolates failures', async() => {
    const controller = new AbortController()
    const started: string[] = []
    const signals: AbortSignal[] = []
    const errors: unknown[] = []
    let releasePicture: (() => void) | undefined
    const picturePending = new Promise<void>(resolve => { releasePicture = resolve })
    const coordinator = new TrackResourceCoordinator({
      downloads: { attachResolvedResources: vi.fn(), publishMetadataPatch: vi.fn(() => false) } as never,
      library: { refresh: vi.fn(), findMatchingFile: vi.fn() } as never,
      libraryResources: { invalidate: vi.fn(), ensure: vi.fn() } as never,
      enricher: { enrich: vi.fn() } as never,
      resources: {
        resolveLyrics: async(_source, _info, signal) => {
          started.push('lyrics')
          if (signal != null) signals.push(signal)
          throw new Error('lyrics unavailable')
        },
        resolvePicture: async(_source, _info, signal) => {
          started.push('picture')
          if (signal != null) signals.push(signal)
          await picturePending
          return { bytes: Uint8Array.from([0xff, 0xd8, 0xff]), mimeType: 'image/jpeg' }
        },
      },
      getSettings: () => ({} as TuneFlow.AppSetting),
      publishEvent: vi.fn(),
      publishLibrary: vi.fn(),
      onError: error => { errors.push(error) },
    })

    coordinator.resolveMissingForDownload('tx', musicInfo, new Set(['lyrics', 'picture']), controller.signal)

    expect(started).toEqual(['lyrics', 'picture'])
    expect(signals).toEqual([controller.signal, controller.signal])
    let idle = false
    const waiting = coordinator.waitForIdle().then(() => { idle = true })
    await Promise.resolve()
    expect(idle).toBe(false)

    releasePicture?.()
    await waiting
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({ message: 'lyrics unavailable' })
  })

  it('notifies clients immediately, attaches active downloads, and then fills a matching local file', async() => {
    const order: string[] = []
    const coordinator = new TrackResourceCoordinator({
      downloads: {
        attachResolvedResources: vi.fn(() => { order.push('attach'); return 1 }),
        publishMetadataPatch: vi.fn(() => false),
      } as never,
      library: {
        findMatchingFile: vi.fn(async() => ({ filePath: '/audio/song.mp3' })),
        refresh: vi.fn(async() => { order.push('refresh'); return [] }),
      } as never,
      libraryResources: {
        invalidate: vi.fn(() => { order.push('invalidate') }),
        ensure: vi.fn(async() => { order.push('ensure') }),
      } as never,
      enricher: {
        enrich: vi.fn(async() => { order.push('enrich'); return { changed: ['lyrics'] } }),
      } as never,
      getSettings: () => ({ 'download.isEmbedLyric': true } as TuneFlow.AppSetting),
      publishEvent: (type, data) => { order.push(`event:${type}`); expect(data).toEqual({ source: 'tx', trackId: 'track-1', resources: ['lyrics'] }) },
      publishLibrary: () => { order.push('library') },
    })

    coordinator.accept({
      identity: { source: 'tx', trackId: 'track-1' },
      musicInfo,
      resources: { lyrics: { lyric: '[00:00.00]Lyric' } },
    })
    await coordinator.waitForIdle()

    expect(order.slice(0, 2)).toEqual(['attach', 'event:track.resources.updated'])
    expect(order).toEqual(['attach', 'event:track.resources.updated', 'enrich', 'invalidate', 'ensure', 'refresh', 'library'])
  })

  it('uses cached resources when a matching download completes', async() => {
    const enrich = vi.fn(async() => ({ changed: [] }))
    const coordinator = new TrackResourceCoordinator({
      downloads: { attachResolvedResources: vi.fn(), publishMetadataPatch: vi.fn(() => false) } as never,
      library: { refresh: vi.fn(), findMatchingFile: vi.fn() } as never,
      libraryResources: { invalidate: vi.fn(), ensure: vi.fn() } as never,
      enricher: { enrich } as never,
      getSettings: () => ({ 'download.isEmbedLyric': true } as TuneFlow.AppSetting),
      getCached: () => ({ lyrics: { lyric: '[00:00.00]Cached' } }),
      publishEvent: vi.fn(),
      publishLibrary: vi.fn(),
    })

    await coordinator.onDownloadCompleted('/audio/new.mp3', { musicInfo } as never)

    expect(enrich).toHaveBeenCalledWith('/audio/new.mp3', { lyrics: { lyric: '[00:00.00]Cached' } }, expect.anything())
  })
})
