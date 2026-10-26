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
const qrPoll = vi.hoisted(() => vi.fn())
vi.mock('./qr', () => ({ createOfficialQr: async() => ({ image: 'data:image/png;base64,synthetic', expiresAt: Date.now() + 120000, poll: qrPoll }) }))
const roots: string[] = []; const apps: Array<ReturnType<typeof Fastify>> = []
const password = 'synthetic-fixture-password'
const fixture = async(configured = true) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'account-routes-test-')); roots.push(root)
  if (configured) await new AccountVault(root).setPassword(password)
  const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } }); apps.push(app)
  app.setErrorHandler((error, _request, reply) => { if (error instanceof ApiError) void reply.code(error.statusCode).send(error.toBody()); else void reply.code(400).send({ error: { code: 'VALIDATION_ERROR' } }) })
  registerAccountRoutes(app as ApiFastifyInstance, root, new ServiceEvents()); await app.ready()
  if (!configured) return { app, headers: {} }
  const login = await app.inject({ method: 'POST', url: '/api/v1/access/login', payload: { password, name: 'fixture' } })
  expect(login.statusCode).toBe(200)
  const token = login.json().data.token
  const headers = { authorization: `Bearer ${token}` }
  return { app, headers }
}
afterEach(async() => { for (const app of apps.splice(0)) await app.close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); qrPoll.mockReset() })
describe('private account routes', () => {
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
