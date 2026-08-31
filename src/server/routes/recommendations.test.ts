import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer } from '../app'
import { SnapshotRepository } from '../recommendations/snapshotRepository'
import type { RankedRecommendation } from '../recommendations/types'

let storageRoot: string
let app: Awaited<ReturnType<typeof createServer>>

beforeEach(async() => {
  storageRoot = mkdtempSync(path.join(os.tmpdir(), 'tuneflow-recommendation-routes-'))
  const webRoot = path.join(storageRoot, 'web')
  mkdirSync(webRoot)
  writeFileSync(path.join(webRoot, 'index.html'), '<!doctype html><title>TuneFlow</title>')
  app = await createServer({ storageRoot, webRoot, host: '127.0.0.1', port: 0 })
})

afterEach(async() => {
  await app.close()
  rmSync(storageRoot, { recursive: true, force: true })
})

describe('recommendation routes', () => {
  it('uses a validated Service time zone while keeping system as the compatible default', async() => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/settings' })).json().data['recommendation.timeZone']).toBe('system')
    const patched = await app.inject({ method: 'PATCH', url: '/api/v1/settings', payload: { 'recommendation.timeZone': 'Pacific/Honolulu' } })
    expect(patched.statusCode).toBe(200)

    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Honolulu', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(Date.now())
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value
    const daily = await app.inject({ method: 'GET', url: '/api/v1/recommendations/daily' })
    expect(daily.json().data.localDate).toBe(`${part('year')}-${part('month')}-${part('day')}`)

    const invalid = await app.inject({ method: 'PATCH', url: '/api/v1/settings', payload: { 'recommendation.timeZone': 'Invalid/Nowhere' } })
    expect(invalid.statusCode).toBe(400)
    expect(invalid.json().error.code).toBe('INVALID_SETTING')
  })

  it('exposes the official MusicBrainz default and supports explicit disable', async() => {
    const settings = (await app.inject({ method: 'GET', url: '/api/v1/settings' })).json().data
    expect(settings['recommendation.musicBrainzBaseUrl']).toBe('https://musicbrainz.org/ws/2/')

    const patched = await app.inject({ method: 'PATCH', url: '/api/v1/settings', payload: { 'recommendation.musicBrainzBaseUrl': '' } })
    expect(patched.statusCode).toBe(200)
    const daily = await app.inject({ method: 'GET', url: '/api/v1/recommendations/daily' })
    expect(daily.json().data).toMatchObject({ status: 'disabled', snapshotLocalDate: null, version: null })
    expect((await app.inject({ method: 'POST', url: '/api/v1/recommendations/daily/refresh' })).statusCode).toBe(409)
  })

  it('validates a draft MusicBrainz address without saving it', async() => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/recommendations/musicbrainz/test',
      payload: { baseUrl: 'not a url' },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json().data).toEqual({ ok: false, normalizedBaseUrl: 'not a url', errorCode: 'invalid_url' })
  })

  it('returns warming immediately and coalesces an asynchronous refresh', async() => {
    const daily = await app.inject({ method: 'GET', url: '/api/v1/recommendations/daily' })
    expect(daily.statusCode).toBe(200)
    expect(daily.json().data).toMatchObject({ status: 'warming', version: null, items: [] })

    const refresh = await app.inject({ method: 'POST', url: '/api/v1/recommendations/daily/refresh' })
    expect(refresh.statusCode).toBe(202)
    expect(refresh.json().data).toMatchObject({ status: 'generating', generationId: expect.any(String) })

    const status = await app.inject({ method: 'GET', url: '/api/v1/recommendations/status' })
    expect(status.statusCode).toBe(200)
    expect(status.json().data).toMatchObject({ version: null, localDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) })
  })

  it('records idempotent feedback, supports undo, and clears only recommendation state', async() => {
    const input = { type: 'not_interested_track', track: { id: 'song', source: 'kw', name: 'Song', singer: 'Artist' } }
    const first = await app.inject({ method: 'POST', url: '/api/v1/recommendations/feedback', payload: input })
    const second = await app.inject({ method: 'POST', url: '/api/v1/recommendations/feedback', payload: input })
    expect(first.statusCode).toBe(200)
    expect(second.json().data.feedbackId).toBe(first.json().data.feedbackId)

    const undo = await app.inject({ method: 'POST', url: '/api/v1/recommendations/feedback', payload: { type: 'undo', feedbackId: first.json().data.feedbackId } })
    expect(undo.json().data).toMatchObject({ active: false, type: 'undo' })

    const cleared = await app.inject({ method: 'DELETE', url: '/api/v1/recommendations/profile' })
    expect(cleared.statusCode).toBe(200)
    expect(cleared.json().data).toEqual({ profile: 0, feedback: 1, exposure: 0, snapshots: 0 })
  })

  it('accepts interested track feedback and lets the user undo it', async() => {
    const input = { type: 'interested_track', track: { id: 'song', source: 'kw', name: 'Song', singer: 'Artist' } }
    const interested = await app.inject({ method: 'POST', url: '/api/v1/recommendations/feedback', payload: input })
    expect(interested.statusCode).toBe(200)
    expect(interested.json().data).toMatchObject({ active: true, type: 'interested_track' })

    const undo = await app.inject({ method: 'POST', url: '/api/v1/recommendations/feedback', payload: { type: 'undo', feedbackId: interested.json().data.feedbackId } })
    expect(undo.statusCode).toBe(200)
    expect(undo.json().data).toMatchObject({ active: false, type: 'undo' })
  })

  it('attributes playback start and terminal effects idempotently through the public history API', async() => {
    let id = 0
    const snapshots = new SnapshotRepository(() => Date.now(), () => `attribution-${++id}`)
    const ranked: RankedRecommendation = {
      canonicalTrackId: 'attributed-track',
      variant: {
        canonicalTrackId: 'attributed-track',
        source: 'kw',
        sourceTrackId: 'attributed-track',
        track: { id: 'attributed-track', source: 'kw', name: 'Attributed', singer: 'Artist' },
        metadataQuality: 1,
        lastSeenAt: Date.now(),
      },
      bucket: 'new',
      reason: { type: 'exploration', labels: [] },
      score: 1,
    }
    const item = snapshots.publish('2026-08-29', 'ready', ['kw'], [ranked]).items[0]
    const started = await app.inject({
      method: 'POST',
      url: '/api/v1/playback/history',
      payload: { track: item.track, platform: 'web', recommendationItemId: item.recommendationItemId },
    })
    const playbackId = started.json().data.playbackId as string
    const terminal = { completed: false, lastPositionSeconds: 10, durationSeconds: 180 }

    expect(started.statusCode).toBe(200)
    expect((await app.inject({ method: 'PATCH', url: `/api/v1/playback/history/${playbackId}`, payload: terminal })).statusCode).toBe(200)
    expect((await app.inject({ method: 'PATCH', url: `/api/v1/playback/history/${playbackId}`, payload: terminal })).statusCode).toBe(200)
    expect(snapshots.effectStats(item.recommendationItemId)).toEqual({ resolved: null, started: 1, completed: 0, accepted: 0, earlySkip: 1 })
  })
})
