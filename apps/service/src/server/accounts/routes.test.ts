import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Fastify from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
const password = 'synthetic-fixture-password'
const fixture = async(configured = true, existingRoot?: string) => {
  const root = existingRoot ?? mkdtempSync(path.join(os.tmpdir(), 'account-routes-test-')); if (!existingRoot) roots.push(root)
  if (configured && !existingRoot) await new AccountVault(root).setPassword(password)
  const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } }); apps.push(app)
  app.setErrorHandler((error, _request, reply) => { if (error instanceof ApiError) void reply.code(error.statusCode).send(error.toBody()); else void reply.code(400).send({ error: { code: 'VALIDATION_ERROR' } }) })
  registerAccountRoutes(app as ApiFastifyInstance, root, new ServiceEvents()); await app.ready()
  if (!configured) return { app, headers: {}, root }
  const login = await app.inject({ method: 'POST', url: '/api/v1/access/login', payload: { password, name: 'fixture' } })
  expect(login.statusCode).toBe(200)
  const token = login.json().data.token
  const headers = { authorization: `Bearer ${token}` }
  return { app, headers, root }
}
beforeEach(() => { vi.stubEnv('TUNEFLOW_ACCESS_PASSWORD', undefined) })
afterEach(async() => { for (const app of apps.splice(0)) await app.close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); qrPoll.mockReset(); qrClose.mockClear(); qrCreate.mockClear(); vi.unstubAllEnvs() })
describe('private account routes', () => {
  it.each([8, 128])('accepts a %i-character startup password and retains existing platform accounts', async length => {
    const initialPassword = 'x'.repeat(length)
    vi.stubEnv('TUNEFLOW_ACCESS_PASSWORD', initialPassword)
    const root = mkdtempSync(path.join(os.tmpdir(), 'account-routes-test-')); roots.push(root)
    new AccountVault(root).put('tx', { cookies: { qqmusic_key: 'synthetic-fixture-credential' } }, 0)
    const { app } = await fixture(false, root)
    expect((await app.inject({ method: 'POST', url: '/api/v1/access/login', payload: { password: initialPassword, name: 'desktop' } })).statusCode).toBe(200)
    expect(new AccountVault(root).account('tx')?.credential.cookies.qqmusic_key).toBe('synthetic-fixture-credential')
  })
  it('initializes from the environment before serving and keeps a changed password and session across restart', async() => {
    vi.stubEnv('TUNEFLOW_ACCESS_PASSWORD', password)
    const { app, root } = await fixture(false)
    const status = await app.inject('/api/v1/access/status')
    expect(status.json().data).toEqual({ passwordConfigured: true })
    expect(status.body).not.toContain(password)
    expect(readFileSync(path.join(root, 'account-security/vault.enc')).includes(Buffer.from(password))).toBe(false)
    const login = await app.inject({ method: 'POST', url: '/api/v1/access/login', payload: { password, name: 'Web' } })
    expect(login.statusCode).toBe(200)
    const headers = { authorization: `Bearer ${login.json().data.token}` }
    const changedPassword = 'synthetic-changed-password'
    expect((await app.inject({ method: 'PUT', url: '/api/v1/access/password', headers, payload: { password: changedPassword, currentPassword: password } })).statusCode).toBe(200)
    await app.close()
    const restarted = (await fixture(false, root)).app
    expect((await restarted.inject({ url: '/api/v1/accounts/status', headers })).statusCode).toBe(200)
    expect((await restarted.inject({ method: 'POST', url: '/api/v1/access/login', payload: { password, name: 'Android' } })).statusCode).toBe(401)
    expect((await restarted.inject({ method: 'POST', url: '/api/v1/access/login', payload: { password: changedPassword, name: 'Android' } })).statusCode).toBe(200)
  })
  it('ignores the environment when a password exists and preserves accounts and sessions', async() => {
    vi.stubEnv('TUNEFLOW_ACCESS_PASSWORD', 'invalid')
    const { app, root, headers } = await fixture()
    expect((await app.inject({ url: '/api/v1/accounts/status', headers })).statusCode).toBe(200)
    await app.close()
    const vault = new AccountVault(root)
    vault.put('tx', { cookies: { qqmusic_key: 'synthetic-fixture-credential' } }, 0)
    const restarted = (await fixture(false, root)).app
    expect((await restarted.inject({ url: '/api/v1/accounts/status', headers })).statusCode).toBe(200)
    expect(new AccountVault(root).account('tx')?.credential.cookies.qqmusic_key).toBe('synthetic-fixture-credential')
  })
  it.each(['', 'short', ' '.repeat(8), 'x'.repeat(129), 'synthetic\npassword'])('rejects invalid startup password case %# without exposing it', async value => {
    vi.stubEnv('TUNEFLOW_ACCESS_PASSWORD', value)
    const error = await fixture(false).then(() => undefined, error => error as Error)
    expect(error).toBeInstanceOf(Error)
    expect(error?.message).toContain('Unable to initialize TUNEFLOW_ACCESS_PASSWORD')
    if (value) expect(error?.message).not.toContain(value)
    expect(new AccountVault(roots[0]).passwordConfigured).toBe(false)
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
  it('supports password access over HTTP and logout without roles or pairing', async() => {
    const { app, headers } = await fixture()
    const demo = { host: '192.168.0.70:3125', origin: 'http://192.168.0.70:3125' }
    const paired = await app.inject({ method: 'POST', url: '/api/v1/access/login', remoteAddress: '192.168.0.20', headers: demo, payload: { password, name: 'HTTP app' } })
    expect(paired.statusCode).toBe(200)
    const member = paired.json().data
    const authenticated = { ...demo, authorization: `Bearer ${member.token}` }
    expect((await app.inject({ url: '/api/v1/accounts/status', remoteAddress: '192.168.0.20', headers: authenticated })).statusCode).toBe(200)
    expect(member.device).not.toHaveProperty('role')
    await app.inject({ method: 'DELETE', url: '/api/v1/access/session', headers: authenticated })
    expect((await app.inject({ url: '/api/v1/accounts/status', remoteAddress: '192.168.0.20', headers: authenticated })).statusCode).toBe(401)
    expect((await app.inject({ url: '/api/v1/accounts/status', headers })).statusCode).toBe(200)
  })
  it('requires a device token and validates browser origin on HTTP', async() => {
    const { app, headers } = await fixture()
    expect((await app.inject('/api/v1/accounts/status')).statusCode).toBe(401)
    const encodedLogout = await app.inject({ method: 'POST', url: '/api/v1/%61ccounts/tx/logout', payload: { revision: 0 } })
    expect([401, 404]).toContain(encodedLogout.statusCode)
    expect((await app.inject({ url: '/api/v1/accounts/status', headers: { ...headers, origin: 'https://attacker.invalid' } })).statusCode).toBe(403)
    const http = await app.inject({ url: '/api/v1/accounts/status', remoteAddress: '192.168.1.3', headers: { ...headers, host: '192.168.1.2:3125', origin: 'http://192.168.1.2:3125' } })
    expect(http.statusCode).toBe(200)
    const forgedProxy = await app.inject({ url: '/api/v1/accounts/status', remoteAddress: '192.168.1.3', headers: { ...headers, host: '192.168.1.2:3125', 'x-forwarded-proto': 'https', origin: 'https://192.168.1.2:3125' } })
    expect(forgedProxy.json().error.code).toBe('ACCOUNT_ORIGIN_REJECTED')
    const status = await app.inject({ url: '/api/v1/accounts/status', headers })
    expect(status.json().data.tx).toBe(false)
    expect(status.body).not.toMatch(/cookies|token|vault|digest/i)
  })
  it('makes QR attempts device-scoped, cancellable and revocable', async() => {
    const { app, headers } = await fixture()
    const second = (await app.inject({ method: 'POST', url: '/api/v1/access/login', payload: { password, name: 'second' } })).json().data
    const memberHeaders = { authorization: `Bearer ${second.token}` }
    const flow = (await app.inject({ method: 'POST', url: '/api/v1/accounts/tx/login', headers: memberHeaders })).json().data
    expect((await app.inject({ method: 'POST', url: `/api/v1/accounts/login/${flow.id}/poll`, headers })).statusCode).toBe(404)
    await app.inject({ method: 'DELETE', url: `/api/v1/accounts/login/${flow.id}`, headers: memberHeaders })
    expect((await app.inject({ method: 'POST', url: `/api/v1/accounts/login/${flow.id}/poll`, headers: memberHeaders })).statusCode).toBe(404)
    await app.inject({ method: 'PUT', url: '/api/v1/access/password', headers, payload: { password: 'changed-password', currentPassword: password } })
    expect((await app.inject({ url: '/api/v1/accounts/status', headers: memberHeaders })).statusCode).toBe(401)
    expect(qrPoll).not.toHaveBeenCalled()
  })
  it('never echoes submitted credentials in validation failures', async() => {
    const { app, headers } = await fixture()
    const result = await app.inject({ method: 'POST', url: '/api/v1/accounts/tx/session', headers, payload: { revision: 0, credential: { cookies: { qqmusic_key: 'synthetic-private-fixture' }, unexpected: true } } })
    expect(result.statusCode).toBe(400)
    expect(result.body).not.toContain('synthetic-private-fixture')
  })
  it('does not let a new visitor set the first password or use the old pairing endpoints', async() => {
    const { app } = await fixture(false)
    const status = await app.inject('/api/v1/access/status')
    expect(status.json().data).toEqual({ passwordConfigured: false })
    expect((await app.inject({ method: 'PUT', url: '/api/v1/access/password', payload: { password } })).statusCode).toBe(401)
    expect((await app.inject({ method: 'POST', url: '/api/v1/access/login', payload: { password, name: 'fixture' } })).json().error.code).toBe('ACCESS_PASSWORD_NOT_CONFIGURED')
    for (const url of ['/api/v1/access/pair', '/api/v1/access/invitations']) expect((await app.inject({ method: 'POST', url, payload: {} })).statusCode).not.toBe(200)
  })
  it('limits incorrect passwords, rejects cross-origin login and never echoes a password', async() => {
    const { app } = await fixture()
    expect((await app.inject({ method: 'POST', url: '/api/v1/access/login', headers: { origin: 'https://attacker.invalid' }, payload: { password, name: 'fixture' } })).statusCode).toBe(403)
    for (let index = 0; index < 4; index++) {
      const result = await app.inject({ method: 'POST', url: '/api/v1/access/login', payload: { password: 'synthetic-wrong-password', name: 'fixture' } })
      expect(result.statusCode).toBe(401); expect(result.body).not.toContain('synthetic-wrong-password')
    }
    expect((await app.inject({ method: 'POST', url: '/api/v1/access/login', payload: { password, name: 'fixture' } })).statusCode).toBe(429)
  })
})
