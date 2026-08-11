import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import { registerCatalogRoutes } from './catalog'

describe('catalog routes', () => {
  it('resolves lyrics through the active user source when it advertises lyric support', async() => {
    const requestSource = vi.fn(async() => ({ lyric: '[00:00.00]fixture' }))
    const sources = {
      list: () => [{ id: 'user_api_fixture', active: true, sources: { kw: { type: 'music', actions: ['musicUrl', 'lyric'], qualitys: ['128k'] } } }],
      requestSource,
    }
    const app = Fastify()
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
