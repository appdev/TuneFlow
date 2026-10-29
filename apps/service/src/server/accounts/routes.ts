import type { FastifyRequest } from 'fastify'
import { Type } from '@fastify/type-provider-typebox'
import type { ApiFastifyInstance } from '../api/types'
import { ApiError } from '../errors'
import { AccountVault, publicDevice, type AccountCredential } from './vault'
import { PlatformAccounts, providers } from './service'
import { createOfficialQr, type QrFlow } from './qr'
import type { ServiceEvents } from '../routes/events'
import { createUserLists, getAllUserList, musicsAdd } from '../db/lists'
import type { MusicAccountProvider } from '../../../../../packages/platform-accounts/src/reader'
import { randomUUID } from 'node:crypto'

export const requireAccountOrigin = (request: FastifyRequest) => {
  const host = request.headers.host ?? ''
  const origin = request.headers.origin
  const encrypted = Boolean((request.raw.socket as { encrypted?: boolean }).encrypted)
  // Reverse proxy trust is explicit and limited to one socket peer and public origin.
  const publicOrigin = process.env.TUNEFLOW_ACCOUNT_PUBLIC_ORIGIN
  const proxy = process.env.TUNEFLOW_ACCOUNT_TRUSTED_PROXY
  let proxied = false
  if (publicOrigin && proxy && request.ip === proxy) {
    try { const url = new URL(publicOrigin); proxied = url.protocol === 'https:' && request.headers['x-forwarded-proto'] === 'https' && request.headers['x-forwarded-host'] === url.host } catch {}
  }
  // Native apps may omit Origin. Browser requests must originate at this service.
  const expected = proxied ? publicOrigin : `${encrypted ? 'https' : 'http'}://${host}`
  if (origin && origin !== 'null' && origin !== expected) throw new ApiError(403, 'ACCOUNT_ORIGIN_REJECTED', 'Account origin rejected')
}

export const registerAccountRoutes = (app: ApiFastifyInstance, configRoot: string, events: ServiceEvents): void => {
  const vault = new AccountVault(configRoot)
  let initialPassword = process.env.TUNEFLOW_ACCESS_PASSWORD
  if (!vault.passwordConfigured && initialPassword !== undefined) {
    // Finish local setup before accepting requests. Existing passwords always win.
    app.addHook('onReady', async() => {
      const password = initialPassword; initialPassword = undefined
      if (password === undefined) return
      try {
        await vault.setPassword(password)
      } catch {
        throw new Error('Unable to initialize TUNEFLOW_ACCESS_PASSWORD. Use 8–128 characters without control characters and ensure account storage is writable.')
      }
    })
  } else { initialPassword = undefined }
  const accounts = new PlatformAccounts(vault, (provider, revision) => { events.publishSnapshot('accounts.changed', { provider, revision }) })
  const authenticate = (request: FastifyRequest) => vault.authorize(/^Bearer ([\w-]+)$/.exec(request.headers.authorization ?? '')?.[1])
  const attempts = new Map<string, { deviceId: string, provider: MusicAccountProvider, revision: number, flow: QrFlow, authorized?: Awaited<ReturnType<QrFlow['poll']>>, cancelled?: boolean, task?: Promise<unknown>, connected?: boolean, lastPoll: number }>()
  const pending = new Set<Promise<QrFlow>>()
  const creating = new Map<string, symbol>()
  const controllers = new Map<symbol, AbortController>()
  const releases = new Set<Promise<void>>()
  let closing = false
  const release = async(flow: QrFlow) => {
    const task = Promise.resolve().then(async() => flow.close?.()).catch(() => {}).then(() => {})
    releases.add(task); void task.finally(() => releases.delete(task))
    return task
  }
  const limits = new Map<string, { count: number, until: number }>()
  const limit = (key: string, max: number, milliseconds = 60_000) => {
    const now = Date.now()
    for (const [id, value] of limits) if (value.until <= now) limits.delete(id)
    let entry = limits.get(key)
    if (!entry) { if (limits.size >= 1024) throw new ApiError(429, 'ACCOUNT_RATE_LIMIT', 'Retry later'); limits.set(key, entry = { count: 0, until: now + milliseconds }) }
    if (++entry.count > max) throw new ApiError(429, 'ACCOUNT_RATE_LIMIT', 'Retry later')
  }
  const clean = () => { for (const [id, attempt] of attempts) if (attempt.flow.expiresAt < Date.now() || attempt.cancelled) { attempt.cancelled = true; attempts.delete(id); void release(attempt.flow) } }
  const cleanupTimer = setInterval(clean, 30_000); cleanupTimer.unref()
  app.addHook('onRequest', async(request, reply) => {
    // Guard the matched route, including percent-encoded spellings of its URL.
    const pathname = request.routeOptions.url ?? request.url.split('?')[0]
    if (!/^\/api\/v1\/(?:accounts|access)(?:\/|$)/.test(pathname)) return
    void reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer')
    requireAccountOrigin(request)
    if (pathname === '/api/v1/access/status' && request.method === 'GET') limit(`access-status:${request.ip}`, 60)
    else if (pathname === '/api/v1/access/login' && request.method === 'POST') {
      limit(`access-login:${request.ip}`, 5); limit('access-login:global', 30)
    } else {
      const device = authenticate(request); limit(`device:${device.id}`, 180)
      if (pathname === '/api/v1/access/password') { limit(`access-password:${device.id}`, 5); limit('access-password:global', 30) }
    }
  })
  const schema = { hide: true }
  const providerSchema = Type.Object({ provider: Type.Union([Type.Literal('tx'), Type.Literal('wy'), Type.Literal('kg')]) }, { additionalProperties: false })
  const revisionSchema = Type.Object({ revision: Type.Integer({ minimum: 0 }) }, { additionalProperties: false })
  app.get('/api/v1/access/status', { schema }, async() => ({ data: { passwordConfigured: vault.passwordConfigured } }))
  app.post('/api/v1/access/login', { bodyLimit: 2048, schema: { ...schema, body: Type.Object({ password: Type.String({ minLength: 1, maxLength: 128 }), name: Type.String({ minLength: 1, maxLength: 80 }) }, { additionalProperties: false }) } }, async request => ({ data: await vault.signIn(request.body.password, request.body.name) }))
  app.get('/api/v1/access/device', { schema }, async request => {
    return { data: { serverId: vault.serverId, device: publicDevice(authenticate(request)), passwordConfigured: vault.passwordConfigured } }
  })
  app.put('/api/v1/access/password', { bodyLimit: 2048, schema: { ...schema, body: Type.Object({ password: Type.String({ minLength: 8, maxLength: 128 }), currentPassword: Type.Optional(Type.String({ maxLength: 128 })) }, { additionalProperties: false }) } }, async request => {
    await vault.setPassword(request.body.password, authenticate(request), request.body.currentPassword)
    for (const controller of controllers.values()) controller.abort()
    creating.clear()
    for (const attempt of attempts.values()) attempt.cancelled = true
    clean()
    events.publishSnapshot('accounts.changed', { revision: vault.revision })
    return { data: { passwordConfigured: true } }
  })
  app.delete('/api/v1/access/session', { schema }, async request => {
    const device = authenticate(request); vault.signOut(device)
    const generation = creating.get(device.id)
    if (generation) controllers.get(generation)?.abort()
    creating.delete(device.id)
    events.publishSnapshot('accounts.changed', { revision: vault.revision })
    for (const attempt of attempts.values()) if (attempt.deviceId === device.id) attempt.cancelled = true
    clean(); return { data: { signedOut: true } }
  })
  app.get('/api/v1/accounts/status', { schema }, async request => {
    const result = await accounts.status(request.query != null && (request.query as { refresh?: string }).refresh === 'true'); authenticate(request)
    return { data: { ...result, revisions: Object.fromEntries(providers.map(provider => [provider, vault.account(provider)?.revision ?? 0])) } }
  })
  app.post('/api/v1/accounts/:provider/session', {
    bodyLimit: 48_000,
    schema: { ...schema, params: providerSchema, body: Type.Object({ revision: Type.Integer({ minimum: 0 }), credential: Type.Object({ cookies: Type.Record(Type.String(), Type.String({ maxLength: 8192 })), kugou: Type.Optional(Type.Unknown()), dailyKey: Type.Optional(Type.String({ maxLength: 1100 })) }, { additionalProperties: false }) }, { additionalProperties: false }) },
  }, async request => ({ data: await accounts.upload(request.params.provider, request.body.credential as AccountCredential, request.body.revision, () => { authenticate(request) }) }))
  app.post('/api/v1/accounts/:provider/logout', { schema: { ...schema, params: providerSchema, body: revisionSchema } }, async request => ({ data: accounts.logout(request.params.provider, request.body.revision) }))
  app.post('/api/v1/accounts/tx/daily-key', { schema: { ...schema, body: Type.Object({ key: Type.String({ minLength: 16, maxLength: 1100 }), revision: Type.Integer({ minimum: 0 }) }, { additionalProperties: false }) } }, async request => ({ data: await accounts.dailyKey(request.body.key, request.body.revision, () => { authenticate(request) }) }))
  app.get('/api/v1/accounts/:provider/playlists', { schema: { ...schema, params: providerSchema } }, async request => { const result = await accounts.playlists(request.params.provider); authenticate(request); return { data: result } })
  app.post('/api/v1/accounts/tx/favorite', { schema: { ...schema, body: Type.Object({ songMid: Type.String({ pattern: '^[a-zA-Z0-9]{1,64}$' }), action: Type.Union([Type.Literal('add'), Type.Literal('check')]), revision: Type.Integer({ minimum: 0 }) }, { additionalProperties: false }) } }, async request => {
    limit(`favorite:${authenticate(request).id}`, 30)
    return { data: await accounts.favorite(request.body, request.body.revision, () => { authenticate(request) }) }
  })
  const collectionBody = Type.Object({ id: Type.String({ minLength: 1, maxLength: 150, pattern: '^[A-Za-z0-9:_-]+$' }), revision: Type.Integer({ minimum: 0 }) }, { additionalProperties: false })
  app.post('/api/v1/accounts/:provider/playlist', { schema: { ...schema, params: providerSchema, body: collectionBody } }, async request => { const result = await accounts.tracks(request.params.provider, request.body.id, request.body.revision); authenticate(request); return { data: result } })
  app.post('/api/v1/accounts/:provider/import', { schema: { ...schema, params: providerSchema, body: collectionBody } }, async request => {
    const provider = request.params.provider
    const snapshot = await accounts.playlists(provider)
    const playlist = snapshot.playlists.find(item => item.id === request.body.id)
    if (!playlist || snapshot.revision !== request.body.revision) throw new ApiError(409, 'ACCOUNT_CHANGED', 'Refresh the account before importing')
    const tracks = await accounts.tracks(provider, request.body.id, request.body.revision)
    authenticate(request)
    if ((vault.account(provider)?.revision ?? 0) !== request.body.revision) throw new ApiError(409, 'ACCOUNT_CHANGED', 'Account changed during import')
    const owner = tracks.importOwner
    if (!owner || !/^[a-f0-9]{32}$/.test(owner)) throw new ApiError(409, 'ACCOUNT_CHANGED', 'Account owner unavailable')
    const sourceId = provider === 'kg' ? playlist.id.replace(/^account:\d+:/, '') : playlist.id
    const id = `account_${provider}_${owner}_${sourceId.replace(':', '_')}`
    if (!getAllUserList().some(item => item.id === id)) createUserLists(2, [{ id, name: playlist.name, source: provider, sourceListId: `account:${owner}:${sourceId}`, locationUpdateTime: null }])
    if (tracks.list.length) musicsAdd(id, tracks.list, 'bottom')
    events.publish('lists.updated', { id })
    return { data: { id, count: tracks.list.length } }
  })
  app.get('/api/v1/accounts/:provider/daily', { schema: { ...schema, params: providerSchema } }, async request => { const result = await accounts.daily(request.params.provider, (request.query as { refresh?: string }).refresh === 'true'); authenticate(request); return { data: result } })
  app.post('/api/v1/accounts/:provider/login', { schema: { ...schema, params: providerSchema } }, async(request, reply) => {
    const device = authenticate(request); limit(`login:${device.id}`, 6); clean()
    if (attempts.size >= 64) throw new ApiError(429, 'ACCOUNT_RATE_LIMIT', 'Too many active logins')
    for (const attempt of attempts.values()) if (attempt.deviceId === device.id) attempt.cancelled = true
    clean()
    await Promise.all([...releases])
    const provider = request.params.provider; const revision = vault.account(provider)?.revision ?? 0
    const previous = creating.get(device.id)
    if (previous) controllers.get(previous)?.abort()
    const generation = Symbol('login'); creating.set(device.id, generation)
    const controller = new AbortController(); controllers.set(generation, controller)
    const disconnected = () => { controller.abort(); if (creating.get(device.id) === generation) creating.delete(device.id) }
    reply.raw.once('close', disconnected)
    const creation = createOfficialQr(provider, controller.signal); pending.add(creation)
    let flow: QrFlow | undefined
    try {
      flow = await creation; authenticate(request)
      if (closing || creating.get(device.id) !== generation || (vault.account(provider)?.revision ?? 0) !== revision) throw new ApiError(409, 'ACCOUNT_LOGIN_EXPIRED', 'Login expired or cancelled')
      const id = randomUUID()
      attempts.set(id, { deviceId: device.id, provider, revision, flow, lastPoll: 0 })
      return { data: { id, provider, image: flow.image, expiresAt: flow.expiresAt } }
    } catch (error) { if (flow) await release(flow); throw error } finally {
      reply.raw.removeListener('close', disconnected)
      pending.delete(creation)
      controllers.delete(generation)
      if (creating.get(device.id) === generation) creating.delete(device.id)
    }
  })
  app.post('/api/v1/accounts/login/:id/poll', { schema: { ...schema, params: Type.Object({ id: Type.String({ maxLength: 64 }) }) } }, async request => {
    const device = authenticate(request); clean(); const attempt = attempts.get(request.params.id)
    if (!attempt || attempt.deviceId !== device.id || attempt.cancelled) throw new ApiError(404, 'ACCOUNT_LOGIN_EXPIRED', 'Login expired or cancelled')
    if (attempt.connected) return { data: { status: 'connected' } }
    if (attempt.task) return { data: await attempt.task }
    if (Date.now() - attempt.lastPoll < 1500) return { data: { status: 'waiting' } }
    attempt.lastPoll = Date.now()
    const guard = () => { authenticate(request); if ((attempt.cancelled ?? false) || attempt.flow.expiresAt < Date.now()) throw new ApiError(409, 'ACCOUNT_LOGIN_EXPIRED', 'Login expired or cancelled') }
    attempt.task = (async() => {
      const result = attempt.authorized ?? await attempt.flow.poll(); guard()
      if (result.status === 'connected') {
        if (!result.credential) throw new ApiError(502, 'ACCOUNT_PROVIDER_ERROR', 'Authorization session missing')
        // The provider may consume the QR ticket on success. Retry verification
        // with this attempt's credential rather than redeeming the ticket again.
        attempt.authorized = result
        await release(attempt.flow)
        await accounts.upload(attempt.provider, result.credential, attempt.revision, guard)
        attempt.connected = true
        attempt.authorized = undefined
      }
      if (result.status === 'expired') { attempt.cancelled = true; await release(attempt.flow) }
      return { status: result.status }
    })()
    try { return { data: await attempt.task } } finally { attempt.task = undefined }
  })
  app.delete('/api/v1/accounts/login/:id', { schema: { ...schema, params: Type.Object({ id: Type.String({ maxLength: 64 }) }) } }, async request => {
    const device = authenticate(request); const attempt = attempts.get(request.params.id)
    if (attempt?.deviceId === device.id) { attempt.cancelled = true; attempts.delete(request.params.id); await release(attempt.flow) }
    return { data: { cancelled: true } }
  })
  app.addHook('preClose', async() => {
    closing = true; clearInterval(cleanupTimer); creating.clear()
    for (const controller of controllers.values()) controller.abort()
    for (const attempt of attempts.values()) { attempt.cancelled = true; void release(attempt.flow) }
    attempts.clear(); limits.clear()
    await Promise.allSettled([...releases])
  })
  app.addHook('onClose', async() => {
    await Promise.allSettled([...pending].map(async creation => release(await creation)))
    await Promise.allSettled([...releases])
    controllers.clear()
  })
}
