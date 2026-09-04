import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer } from '../app'

let storageRoot: string
let app: Awaited<ReturnType<typeof createServer>>

beforeEach(async() => {
  storageRoot = mkdtempSync(path.join(os.tmpdir(), 'tuneflow-radio-routes-'))
  const webRoot = path.join(storageRoot, 'web')
  mkdirSync(webRoot)
  writeFileSync(path.join(webRoot, 'index.html'), '<!doctype html><title>TuneFlow</title>')
  app = await createServer({ storageRoot, webRoot, host: '127.0.0.1', port: 0 })
})

afterEach(async() => {
  await app.close()
  rmSync(storageRoot, { recursive: true, force: true })
})

describe('radio routes', () => {
  const batch = {
    requestId: 'request-1',
    queueGeneration: 1,
    currentTrack: { id: 'current', source: 'kw', name: 'Current', singer: 'Artist' },
    queuedTracks: [],
    limit: 3,
  }

  it('creates, reads, idempotently advances, and closes a degraded local session', async() => {
    const created = await app.inject({ method: 'POST', url: '/api/v1/radio/sessions', payload: { mode: 'dedicated', ...batch } })
    expect(created.statusCode).toBe(200)
    expect(created.json().data).toMatchObject({ mode: 'dedicated', status: 'degraded', aiStatus: 'disabled', items: [] })
    const sessionId = created.json().data.sessionId as string

    expect((await app.inject({ method: 'GET', url: `/api/v1/radio/sessions/${sessionId}` })).statusCode).toBe(200)
    const next = { ...batch, requestId: 'request-2', queueGeneration: 2 }
    const first = await app.inject({ method: 'POST', url: `/api/v1/radio/sessions/${sessionId}/next`, payload: next })
    const duplicate = await app.inject({ method: 'POST', url: `/api/v1/radio/sessions/${sessionId}/next`, payload: next })
    expect(duplicate.json()).toEqual(first.json())

    expect((await app.inject({ method: 'DELETE', url: `/api/v1/radio/sessions/${sessionId}` })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: `/api/v1/radio/sessions/${sessionId}` })).statusCode).toBe(404)
  })

  it('does not expose a secret and rejects invalid queue bounds', async() => {
    process.env.TUNEFLOW_RECOMMENDATION_AI_API_KEY = 'never-return-this-secret'
    try {
      const settings = await app.inject({ method: 'GET', url: '/api/v1/settings' })
      expect(settings.body).not.toContain('never-return-this-secret')
      expect((await app.inject({ method: 'GET', url: '/api/v1/recommendations/ai/status' })).body).not.toContain('never-return-this-secret')
      const valid = await app.inject({ method: 'POST', url: '/api/v1/radio/sessions', payload: { mode: 'dedicated', ...batch, limit: 10 } })
      expect(valid.statusCode).toBe(200)
      const invalid = await app.inject({ method: 'POST', url: '/api/v1/radio/sessions', payload: { mode: 'dedicated', ...batch, limit: 11 } })
      expect(invalid.statusCode).toBe(400)
    } finally { delete process.env.TUNEFLOW_RECOMMENDATION_AI_API_KEY }
  })
})
