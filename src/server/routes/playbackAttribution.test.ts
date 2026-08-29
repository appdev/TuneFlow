import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerPlaybackRoutes } from './playback'

const apps: FastifyInstance[] = []

afterEach(async() => {
  await Promise.all(apps.splice(0).map(async app => { await app.close() }))
})

describe('playback recommendation attribution', () => {
  it('attributes only explicitly linked resolve attempts and records success or unplayable outcomes', async() => {
    const app = Fastify()
    apps.push(app)
    const onRecommendationResolve = vi.fn()
    registerPlaybackRoutes(app, {
      resolveTrack: async input => {
        if ((input.info as { id?: string }).id === 'broken') throw Object.assign(new Error('unplayable'), { code: 'SOURCE_PROTOCOL_ERROR' })
        return { url: '/api/v1/streams/token', quality: '128k', expiresAt: 123 }
      },
      onRecommendationResolve,
    })

    const success = await app.inject({
      method: 'POST',
      url: '/api/v1/playback/tracks/resolve',
      payload: { source: 'kw', quality: '128k', info: { id: 'ok' }, recommendationItemId: 'recommendation-1' },
    })
    const manual = await app.inject({
      method: 'POST',
      url: '/api/v1/playback/tracks/resolve',
      payload: { source: 'kw', quality: '128k', info: { id: 'manual' } },
    })
    const failed = await app.inject({
      method: 'POST',
      url: '/api/v1/playback/tracks/resolve',
      payload: { source: 'kw', quality: '128k', info: { id: 'broken' }, recommendationItemId: 'recommendation-2' },
    })

    expect(success.statusCode).toBe(200)
    expect(manual.statusCode).toBe(200)
    expect(failed.statusCode).toBe(500)
    expect(onRecommendationResolve.mock.calls.map(([event]) => event)).toEqual([
      { recommendationItemId: 'recommendation-1', outcome: 'resolved' },
      { recommendationItemId: 'recommendation-2', outcome: 'unplayable' },
    ])
  })
})
