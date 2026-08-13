import Fastify from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerCatalogRoutes } from './catalog'
import musicSdk from '../../renderer/utils/musicSdk'
import { ApiError } from '../errors'

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
      payload: { source: 'kw', musicInfo: { id: 'track', source: 'kw' } },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ data: { lyric: '[00:00.00]fixture' } })
    expect(requestSource).toHaveBeenCalledWith('user_api_fixture', {
      source: 'kw', action: 'lyric', info: { id: 'track', source: 'kw' },
    })
    await app.close()
  })
})
