import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Fastify from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerAccountRoutes } from './routes'
import { ApiError } from '../errors'
import { ServiceEvents } from '../routes/events'
import { AccountVault } from './vault'
import type { ApiFastifyInstance } from '../api/types'
import { PlatformAccounts } from './service'
const qrPoll = vi.hoisted(() => vi.fn())
const qrClose = vi.hoisted(() => vi.fn(async() => {}))
const qrCreate = vi.hoisted(() => vi.fn())
vi.mock('./qr', () => ({ createOfficialQr: async() => { qrCreate(); return { image: 'data:image/png;base64,synthetic', expiresAt: Date.now() + 120000, poll: qrPoll, close: qrClose } } }))
const roots: string[] = []; const apps: Array<ReturnType<typeof Fastify>> = []

const fixture = async(existingRoot?: string) => {
  const root = existingRoot ?? mkdtempSync(path.join(os.tmpdir(), 'account-routes-test-')); if (!existingRoot) roots.push(root)
  const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } }); apps.push(app)
  app.setErrorHandler((error, _request, reply) => { if (error instanceof ApiError) void reply.code(error.statusCode).send(error.toBody()); else void reply.code(400).send({ error: { code: 'VALIDATION_ERROR' } }) })
  registerAccountRoutes(app as ApiFastifyInstance, root, new ServiceEvents()); await app.ready()
  return { app, headers: { 'x-tuneflow-client-id': 'fixture-client-one' }, root }
}
afterEach(async() => { for (const app of apps.splice(0)) await app.close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); qrPoll.mockReset(); qrClose.mockClear(); qrCreate.mockClear(); vi.unstubAllEnvs() })
describe('shared account routes without access passwords', () => {
  it('serves a fresh instance and relay origins without a password, token or forwarded headers', async() => {
    vi.stubEnv('TUNEFLOW_ACCESS_PASSWORD', 'obsolete-invalid-value')
    const { app, root } = await fixture()
    for (const headers of [{}, { host: 'service:3124', origin: 'https://relay.example.com' }, { authorization: 'Bearer obsolete-token' }]) {
      const response = await app.inject({ url: '/api/v1/accounts/status', headers })
      expect(response.statusCode).toBe(200)
      expect(response.json().data.tx).toBe(false)
      expect(response.body).not.toMatch(/cookies|token|vault|digest|password/i)
    }
    const before = (await app.inject('/api/v1/accounts/status')).json().data.serverId
    await app.close()
    const restarted = (await fixture(root)).app
    expect((await restarted.inject('/api/v1/accounts/status')).json().data.serverId).toBe(before)
  })
  it('retains saved platform credentials across restart without login', async() => {
    const { app, root } = await fixture()
    await app.close()
    new AccountVault(root).put('tx', { cookies: { qqmusic_key: 'synthetic-preserved' } }, 0)
    const restarted = (await fixture(root)).app
    const response = await restarted.inject({ method: 'POST', url: '/api/v1/accounts/tx/logout', payload: { revision: 1 } })
    expect(response.statusCode).toBe(200)
    expect(new AccountVault(root).account('tx')?.credential.cookies).toEqual({})
    expect(new AccountVault(root).revision).toBe(2)
  })
  it('finishes disposal before allocating a replacement browser slot', async() => {
    const { app, headers } = await fixture()
    await app.inject({ method: 'POST', url: '/api/v1/accounts/wy/login', headers })
    let finish!: () => void
    const disposed = new Promise<void>(resolve => { finish = resolve })
    qrClose.mockImplementationOnce(async() => disposed)
    const replacement = app.inject({ method: 'POST', url: '/api/v1/accounts/wy/login', headers }).then(response => response)
    await vi.waitFor(() => { expect(qrClose).toHaveBeenCalledOnce() })
    expect(qrCreate).toHaveBeenCalledTimes(1)
    finish()
    expect((await replacement).statusCode).toBe(200)
    expect(qrCreate).toHaveBeenCalledTimes(2)
  })
  it('releases sessions on replacement, cancellation, expiry and shutdown', async() => {
    const { app, headers } = await fixture()
    const create = async() => (await app.inject({ method: 'POST', url: '/api/v1/accounts/wy/login', headers })).json().data.id
    await create()
    const second = await create()
    expect(qrClose).toHaveBeenCalledTimes(1)
    await app.inject({ method: 'DELETE', url: `/api/v1/accounts/login/${second}`, headers })
    expect(qrClose).toHaveBeenCalledTimes(2)
    await create()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 120001)
    try { await create(); expect(qrClose).toHaveBeenCalledTimes(3) } finally { clock.mockRestore() }
    await app.close()
    expect(qrClose).toHaveBeenCalledTimes(4)
  })
  it('retries verification of an authorized QR without redeeming the provider ticket again', async() => {
    const { app, headers } = await fixture()
    const credential = { cookies: { MUSIC_U: 'synthetic-music-session' } }
    qrPoll.mockResolvedValueOnce({ status: 'connected', credential })
    const upload = vi.spyOn(PlatformAccounts.prototype, 'upload')
      .mockRejectedValueOnce(new ApiError(502, 'ACCOUNT_PROVIDER_ERROR', 'Temporary verification failure'))
      .mockResolvedValue({ provider: 'wy', status: 'connected', revision: 1 })
    const now = Date.now(); const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
    try {
      const login = await app.inject({ method: 'POST', url: '/api/v1/accounts/wy/login', headers })
      const url = `/api/v1/accounts/login/${login.json().data.id}/poll`
      expect((await app.inject({ method: 'POST', url, headers })).statusCode).toBe(502)
      clock.mockReturnValue(now + 2500)
      const result = await app.inject({ method: 'POST', url, headers })
      expect(result.statusCode).toBe(200)
      expect(result.json()).toEqual({ data: { status: 'connected' } })
      expect(qrPoll).toHaveBeenCalledTimes(1)
      expect(upload).toHaveBeenCalledTimes(2)
      expect(upload.mock.calls[1][1]).toEqual(credential)
      expect(result.body).not.toContain('synthetic-music-session')
    } finally { upload.mockRestore(); clock.mockRestore() }
  })

  it('keeps simultaneous QR attempts separate by client without authorizing devices', async() => {
    const { app, headers } = await fixture()
    const second = { 'x-tuneflow-client-id': 'fixture-client-two' }
    const flow = (await app.inject({ method: 'POST', url: '/api/v1/accounts/tx/login', headers })).json().data
    expect((await app.inject({ method: 'POST', url: '/api/v1/accounts/wy/login', headers: second })).statusCode).toBe(200)
    expect(qrClose).not.toHaveBeenCalled()
    expect((await app.inject({ method: 'POST', url: `/api/v1/accounts/login/${flow.id}/poll`, headers: second })).statusCode).toBe(404)
    await app.inject({ method: 'DELETE', url: `/api/v1/accounts/login/${flow.id}`, headers: second })
    qrPoll.mockResolvedValueOnce({ status: 'waiting' })
    expect((await app.inject({ method: 'POST', url: `/api/v1/accounts/login/${flow.id}/poll`, headers })).statusCode).toBe(200)
    await app.inject({ method: 'DELETE', url: `/api/v1/accounts/login/${flow.id}`, headers })
    expect((await app.inject({ method: 'POST', url: `/api/v1/accounts/login/${flow.id}/poll`, headers })).statusCode).toBe(404)
  })
  it('never echoes submitted credentials in validation failures', async() => {
    const { app } = await fixture()
    const result = await app.inject({ method: 'POST', url: '/api/v1/accounts/tx/session', payload: { revision: 0, credential: { cookies: { qqmusic_key: 'synthetic-private-fixture' }, unexpected: true } } })
    expect(result.statusCode).toBe(400)
    expect(result.body).not.toContain('synthetic-private-fixture')
  })
  it('removes password, session and pairing endpoints', async() => {
    const { app } = await fixture()
    for (const [method, url] of [['GET', '/api/v1/access/status'], ['GET', '/api/v1/access/device'], ['POST', '/api/v1/access/login'], ['PUT', '/api/v1/access/password'], ['DELETE', '/api/v1/access/session'], ['POST', '/api/v1/access/pair']] as const) {
      expect((await app.inject({ method, url })).statusCode).toBe(404)
    }
  })
  it('still bounds QR creation attempts', async() => {
    const { app, headers } = await fixture()
    for (let index = 0; index < 6; index++) expect((await app.inject({ method: 'POST', url: '/api/v1/accounts/tx/login', headers })).statusCode).toBe(200)
    expect((await app.inject({ method: 'POST', url: '/api/v1/accounts/tx/login', headers })).statusCode).toBe(429)
  })
})
