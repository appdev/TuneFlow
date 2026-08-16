import Fastify from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerCatalogRoutes } from './catalog'
import musicSdk from '../../renderer/utils/musicSdk'
import { ApiError } from '../errors'
import { SourceServiceError } from '../sources/types'
import { PlaybackResourceStore } from '../playback/resourceStore'

afterEach(() => { vi.restoreAllMocks() })

const appWithProductionErrors = () => {
  const app = Fastify()
  app.setErrorHandler((error, _request, reply) => {
    if ('validation' in error) return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Request validation failed' } })
    if (error instanceof ApiError) return reply.code(error.statusCode).send(error.toBody())
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } })
  })
  return app
}

describe('catalog routes', () => {
  it('rejects track resource requests without a track identity', async() => {
    const requestSource = vi.fn(async() => ({ lyric: '[00:00.00]fixture' }))
    const sources = {
      list: () => [{ id: 'user_api_fixture', active: true, sources: { kw: { type: 'music', actions: ['lyric'], qualitys: [] } } }],
      requestSource,
    }
    const app = appWithProductionErrors()
    registerCatalogRoutes(app as never, sources as never)

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/catalog/tracks/lyrics',
      payload: { source: 'kw', musicInfo: {} },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: { code: 'VALIDATION_ERROR', message: 'Request validation failed' } })
    expect(requestSource).not.toHaveBeenCalled()
    await app.close()
  })

  it('advertises only search kinds implemented by each built-in provider', async() => {
    const app = appWithProductionErrors()
    registerCatalogRoutes(app as never)

    const response = await app.inject({ method: 'GET', url: '/api/v1/catalog/capabilities' })

    expect(response.statusCode).toBe(200)
    const providers = response.json().data.sources as Array<{ id: string, searchKinds: string[], leaderboards: boolean, playlistDiscovery?: { tags: boolean, browse: boolean, detail: boolean } }>
    expect(providers.find(provider => provider.id === 'kw')?.searchKinds).toEqual(expect.arrayContaining(['track', 'playlist']))
    expect(providers.find(provider => provider.id === 'kw')?.searchKinds).not.toContain('album')
    expect(providers.find(provider => provider.id === 'wy')?.searchKinds).toEqual(expect.arrayContaining(['track', 'playlist', 'album']))
    expect(providers.find(provider => provider.id === 'wy')?.leaderboards).toBe(true)
    expect(providers.find(provider => provider.id === 'kw')?.playlistDiscovery).toEqual({ tags: true, browse: true, detail: true })
    await app.close()
  })

  it('returns normalized playlist discovery envelopes', async() => {
    vi.spyOn(musicSdk.kw.songList, 'getTags').mockResolvedValue({
      tags: [{ name: '主题', list: [{ id: '2189-10000', name: '短视频' }] }],
      hotTag: [],
      source: 'kw',
    })
    vi.spyOn(musicSdk.kw.songList, 'getList').mockResolvedValue({
      list: [{ id: 'digest-8__1', name: 'Fixture playlist', source: 'kw' }], total: 1, limit: 36, page: 1, source: 'kw',
    })
    vi.spyOn(musicSdk.kw.songList, 'getListDetail').mockResolvedValue({
      list: [{ songmid: 'track-1', name: 'Fixture', singer: 'Artist', interval: '03:00', source: 'kw' }],
      total: 1,
      limit: 1000,
      page: 1,
      source: 'kw',
      info: { name: 'Fixture playlist' },
    })
    const app = appWithProductionErrors()
    registerCatalogRoutes(app as never)

    const tags = await app.inject({ method: 'POST', url: '/api/v1/catalog/playlists/tags', payload: { source: 'kw' } })
    const browse = await app.inject({
      method: 'POST', url: '/api/v1/catalog/playlists/browse', payload: { source: 'kw', sortId: 'hot', tagId: '', page: 1 },
    })
    const detail = await app.inject({
      method: 'POST', url: '/api/v1/catalog/playlists/detail', payload: { source: 'kw', playlistId: 'digest-8__1', page: 1 },
    })

    expect(tags.statusCode).toBe(200)
    expect(tags.json().data).toMatchObject({ source: 'kw', hotTags: [], groups: [{ name: '主题' }] })
    expect(browse.statusCode).toBe(200)
    expect(browse.json().data).toMatchObject({ source: 'kw', page: 1, total: 1, hasMore: false })
    expect(detail.statusCode).toBe(200)
    expect(detail.json().data).toMatchObject({ source: 'kw', playlist: { id: 'digest-8__1' }, tracks: [{ id: 'track-1' }] })
    await app.close()
  })

  it('rejects malformed browse requests and unsafe detail ids', async() => {
    const detail = vi.spyOn(musicSdk.kw.songList, 'getListDetail')
    const app = appWithProductionErrors()
    registerCatalogRoutes(app as never)

    const malformed = await app.inject({
      method: 'POST', url: '/api/v1/catalog/playlists/browse', payload: { source: 'kw', sortId: 'hot', tagId: '', page: 0, extra: true },
    })
    const unsafe = await app.inject({
      method: 'POST', url: '/api/v1/catalog/playlists/detail', payload: { source: 'kw', playlistId: 'http://127.0.0.1/private', page: 1 },
    })

    expect(malformed.statusCode).toBe(400)
    expect(unsafe.statusCode).toBe(400)
    expect(unsafe.json().error.code).toBe('INVALID_PLAYLIST_ID')
    expect(detail).not.toHaveBeenCalled()
    await app.close()
  })

  it('resolves lyrics through the active user source when it advertises lyric support', async() => {
    const requestSource = vi.fn(async() => ({ lyric: '[00:00.00]fixture' }))
    const sources = {
      list: () => [{ id: 'user_api_fixture', active: true, sources: { kw: { type: 'music', actions: ['musicUrl', 'lyric'], qualitys: ['128k'] } } }],
      requestSource,
    }
    const app = appWithProductionErrors()
    registerCatalogRoutes(app as never, sources as never)

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/catalog/tracks/lyrics',
      payload: {
        source: 'kw',
        musicInfo: {
          id: 'kw_track',
          name: 'Fixture',
          source: 'kw',
          meta: { songId: 'track', picUrl: 'https://snapshot.test/cover.jpg' },
        },
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ data: { lyric: '[00:00.00]fixture' } })
    expect(requestSource).toHaveBeenCalledWith('user_api_fixture', expect.objectContaining({
      source: 'kw',
      action: 'lyric',
      info: expect.objectContaining({ songmid: 'track', img: 'https://snapshot.test/cover.jpg' }),
    }), expect.any(AbortSignal))
    await app.close()
  })

  it('rejects provider lyrics containing Unicode replacement characters', async() => {
    const sources = {
      list: () => [{ id: 'user_api_fixture', active: true, sources: { kw: { type: 'music', actions: ['lyric'], qualitys: [] } } }],
      requestSource: vi.fn(async() => ({
        lyric: '[00:00.00]clean',
        tlyric: '[00:00.00]broken\uFFFDtranslation',
        verbatimLyric: '[00:00.00]<0,100>clean',
      })),
    }
    const app = appWithProductionErrors()
    registerCatalogRoutes(app as never, sources as never, { getBuiltinLyrics: async() => undefined })

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/catalog/tracks/lyrics',
      payload: { source: 'kw', musicInfo: { id: 'track', source: 'kw' } },
    })

    expect(response.statusCode).toBe(502)
    expect(response.json()).toEqual({ error: { code: 'SOURCE_ALL_UNAVAILABLE', message: 'Lyric lookup failed' } })
    await app.close()
  })

  it('uses ordered sources for lyrics after a trusted network failure', async() => {
    const requestSource = vi.fn(async(sourceId: string) => {
      if (sourceId === 'a') throw new SourceServiceError('SOURCE_NETWORK_ERROR', 'offline', 'service-network')
      return { lyric: '[00:00.00]backup' }
    })
    const sources = {
      snapshot: () => [{ id: 'a', priority: 0 }, { id: 'b', priority: 1 }],
      requestSource,
    }
    const app = appWithProductionErrors()
    registerCatalogRoutes(app as never, sources as never)

    const response = await app.inject({
      method: 'POST', url: '/api/v1/catalog/tracks/lyrics', payload: { source: 'kw', musicInfo: { id: 'track', source: 'kw' } },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ data: { lyric: '[00:00.00]backup' } })
    expect(requestSource.mock.calls.map(call => call[0])).toEqual(['a', 'b'])
    await app.close()
  })

  it('continues lyrics lookup after a source-script failure', async() => {
    const requestSource = vi.fn(async(sourceId: string) => {
      if (sourceId === 'a') throw new SourceServiceError('SOURCE_PROTOCOL_ERROR', 'broken script', 'script')
      return { lyric: '[00:00.00]backup' }
    })
    const sources = {
      snapshot: () => [{ id: 'a', priority: 0 }, { id: 'b', priority: 1 }],
      requestSource,
    }
    const app = appWithProductionErrors()
    registerCatalogRoutes(app as never, sources as never)

    const response = await app.inject({
      method: 'POST', url: '/api/v1/catalog/tracks/lyrics', payload: { source: 'kw', musicInfo: { id: 'track', source: 'kw' } },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ data: { lyric: '[00:00.00]backup' } })
    expect(requestSource.mock.calls.map(call => call[0])).toEqual(['a', 'b'])
    await app.close()
  })

  it('validates source artwork and returns an opaque same-origin URL', async() => {
    const resources = new PlaybackResourceStore()
    const sources = {
      snapshot: () => [{ id: 'a', priority: 0 }],
      requestSource: vi.fn(async() => 'https://secret.test/picture'),
    }
    const mediaClient = {
      fetchArtwork: vi.fn(async() => ({ bytes: Uint8Array.from([1, 2, 3]), mimeType: 'image/png' })),
    }
    const app = appWithProductionErrors()
    registerCatalogRoutes(app as never, sources as never, { mediaClient: mediaClient as never, resourceStore: resources })

    const response = await app.inject({
      method: 'POST', url: '/api/v1/catalog/tracks/picture', payload: { source: 'kw', musicInfo: { id: 'track', source: 'kw' } },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data.url).toMatch(/^\/api\/v1\/playback\/resources\/[a-f0-9]{64}\/picture$/)
    expect(response.body).not.toContain('secret.test')
    await app.close()
  })
})
