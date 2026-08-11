import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { constants, generateKeyPairSync, publicEncrypt } from 'node:crypto'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseSourceScript } from './parser'
import { SourceRepository } from './repository'
import { SourceWorkerHost } from './worker-host'
import { requestSourceNetwork } from './network'
import { SourcesService } from '../routes/sources'
import { close as closeDatabase, getDB, init as initDatabase } from '../db/core/db'

process.env.LX_SERVICE_NODE_MODULES = path.join(process.cwd(), 'dist/server/node_modules')

const roots: string[] = []
const hosts: SourceWorkerHost[] = []

const fixtureScript = `/*
 * @name Deterministic fixture
 * @description Source worker fixture
 * @version 1.0.0
 * @author LX
 */
window.lx.on(window.lx.EVENT_NAMES.request, async ({ source, action }) => {
  if (source !== 'fixture') throw new Error('unexpected source')
  if (action === 'wait') await new Promise(() => {})
  if (action === 'musicUrl') return 'https://example.test/audio'
  if (action === 'lyric') return { lyric: 'fixture lyric' }
  if (action === 'pic') return 'https://example.test/pic'
  throw new Error('unexpected action')
})
window.lx.send(window.lx.EVENT_NAMES.inited, {
  sources: { fixture: { type: 'music', actions: ['musicUrl', 'lyric', 'pic'], qualitys: ['320k'] } },
})`

const script = (name: string, body: string) => `/*
 * @name ${name}
 * @description Fixture source
 * @version 1.0.0
 */
${body}`

afterEach(async() => {
  await Promise.all(hosts.splice(0).map(async host => host.close()))
  closeDatabase()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('LX service sources', () => {
  it('parses a valid LX script header', () => {
    expect(parseSourceScript(fixtureScript)).toMatchObject({ name: 'Deterministic fixture', version: '1.0.0' })
  })

  it('accepts an empty optional description like the desktop importer', () => {
    expect(parseSourceScript(`/*!
 * @name ikun source
 * @description
 * @version v22
 */`)).toMatchObject({ name: 'ikun source', description: '', version: 'v22' })
  })

  it('rejects a script with required metadata missing', () => {
    expect(() => parseSourceScript('/* @name Missing */\nwindow.lx.send()')).toThrow('SOURCE_INVALID_METADATA')
  })

  it('rejects duplicate installed source ids', async() => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'lx-source-'))
    roots.push(root)
    mkdirSync(path.join(root, 'sources'))
    initDatabase(root)
    const repository = new SourceRepository(root)
    const first = await repository.installSource(fixtureScript)
    await expect(repository.installSource(fixtureScript)).rejects.toMatchObject({ code: 'SOURCE_DUPLICATE' })
    expect(repository.listSources()).toEqual([first])
  })

  it('resolves an installed script from the current storage root after data is moved', async() => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'lx-source-moved-'))
    roots.push(root)
    mkdirSync(path.join(root, 'sources'))
    initDatabase(root)
    const repository = new SourceRepository(root)
    const installed = await repository.installSource(fixtureScript)
    getDB().prepare('UPDATE web_sources SET script_path=? WHERE id=?').run(`/data/sources/${installed.id.substring('user_api_'.length)}.js`, installed.id)
    const service = new SourcesService(repository)

    await expect(service.activate(installed.id)).resolves.toMatchObject({ id: installed.id, active: true })
    await service.close()
  })

  it('terminates a request exceeding fifteen seconds', async() => {
    const host = new SourceWorkerHost({ id: 'timeout', ...parseSourceScript(fixtureScript), script: fixtureScript }, { requestTimeoutMs: 10 })
    hosts.push(host)
    await expect(host.request({ source: 'fixture', action: 'wait' })).rejects.toMatchObject({ code: 'SOURCE_TIMEOUT' })
  })

  it('enforces the outstanding source-request cap', async() => {
    const slow = script('Outstanding cap', `
window.lx.on(window.lx.EVENT_NAMES.request, async () => await new Promise(() => {}))
window.lx.send(window.lx.EVENT_NAMES.inited, { sources: { fixture: { type: 'music', actions: ['lyric'], qualitys: [] } } })`)
    const host = new SourceWorkerHost({ id: 'cap', ...parseSourceScript(slow), script: slow }, { requestTimeoutMs: 1_000, maxOutstanding: 2 })
    hosts.push(host)
    const first = host.request({ source: 'fixture', action: 'lyric' })
    const second = host.request({ source: 'fixture', action: 'lyric' })
    await expect(host.request({ source: 'fixture', action: 'lyric' })).rejects.toMatchObject({ code: 'SOURCE_PROTOCOL_ERROR' })
    await host.close()
    await expect(first).rejects.toMatchObject({ code: 'SOURCE_PROTOCOL_ERROR' })
    await expect(second).rejects.toMatchObject({ code: 'SOURCE_PROTOCOL_ERROR' })
  })

  it('keeps the default outstanding source-request cap at sixteen', async() => {
    const slow = script('Default outstanding cap', `
window.lx.on(window.lx.EVENT_NAMES.request, async () => await new Promise(() => {}))
window.lx.send(window.lx.EVENT_NAMES.inited, { sources: { fixture: { type: 'music', actions: ['lyric'], qualitys: [] } } })`)
    const host = new SourceWorkerHost({ id: 'default-cap', ...parseSourceScript(slow), script: slow }, { requestTimeoutMs: 1_000 })
    hosts.push(host)
    const admitted = Array.from({ length: 16 }, async() => host.request({ source: 'fixture', action: 'lyric' }))
    await expect(host.request({ source: 'fixture', action: 'lyric' })).rejects.toMatchObject({ code: 'SOURCE_PROTOCOL_ERROR' })
    await host.close()
    await Promise.all(admitted.map(async request => expect(request).rejects.toMatchObject({ code: 'SOURCE_PROTOCOL_ERROR' })))
  })

  it('rejects an oversized eight MiB response', async() => {
    const body = new Uint8Array(8 * 1024 * 1024 + 1)
    const error = await requestSourceNetwork('https://example.test/too-large', {}, undefined, {
      fetch: async() => new Response(body),
      lookup: async() => ['203.0.113.1'],
    }).catch(error => error)
    expect(error).toMatchObject({ code: 'SOURCE_RESPONSE_TOO_LARGE' })
  })

  it('enforces an absolute source network deadline', async() => {
    let aborted = false
    const request = requestSourceNetwork('https://fixture.test/slow', {}, undefined, {
      networkTimeoutMs: 10,
      lookup: async() => ['203.0.113.1'],
      fetch: async(_url, init) => await new Promise<Response>((_resolve, reject) => {
        init.signal!.addEventListener('abort', () => {
          aborted = true
          reject(new DOMException('aborted', 'AbortError'))
        })
      }),
    })
    await expect(request).rejects.toMatchObject({ code: 'SOURCE_TIMEOUT' })
    expect(aborted).toBe(true)
  })

  it('uses native Undici DNS pinning for GET and multipart form data', async() => {
    const received: Array<{ method?: string, contentType?: string, body: string }> = []
    const server = http.createServer((request, response) => {
      let body = ''
      request.setEncoding('utf8')
      request.on('data', chunk => { body += chunk })
      request.on('end', () => {
        received.push({ method: request.method, contentType: request.headers['content-type'], body })
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ ok: true }))
      })
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as { port: number }).port
    const network = { allowPrivateNetwork: true, lookup: async() => ['127.0.0.1'] }
    try {
      await requestSourceNetwork(`http://fixture.test:${port}/get`, {}, undefined, network)
      await requestSourceNetwork(`http://fixture.test:${port}/multipart`, { method: 'POST', formData: { title: 'fixture' } }, undefined, network)
    } finally {
      await new Promise<void>(resolve => server.close(() => { resolve() }))
    }
    expect(received).toHaveLength(2)
    expect(received[0].method).toBe('GET')
    expect(received[1]).toMatchObject({ method: 'POST', contentType: expect.stringContaining('multipart/form-data'), body: expect.stringContaining('fixture') })
  })

  it('cancels an in-flight source request', async() => {
    const host = new SourceWorkerHost({ id: 'cancel', ...parseSourceScript(fixtureScript), script: fixtureScript })
    hosts.push(host)
    const controller = new AbortController()
    const request = host.request({ source: 'fixture', action: 'wait' }, controller.signal)
    controller.abort()
    await expect(request).rejects.toMatchObject({ code: 'SOURCE_CANCELLED' })
  })

  it('normalizes LX music result fields', async() => {
    const host = new SourceWorkerHost({ id: 'fixture', ...parseSourceScript(fixtureScript), script: fixtureScript })
    hosts.push(host)
    await expect(host.request({ source: 'fixture', action: 'lyric' })).resolves.toEqual({ lyric: 'fixture lyric', tlyric: null, rlyric: null, lxlyric: null })
    expect(SourceWorkerHost.normalizeSearchResult({
      list: [{ songmid: 42, name: 42, singer: null, source: 3, interval: 215, _types: { '320k': { size: '8M' } }, types: [{ type: '320k', size: '8M' }] }],
      total: 1,
      limit: 20,
      page: 1,
      source: 'fixture',
    })).toEqual({
      list: [{ id: '42', songmid: '42', name: '42', singer: '', source: 'fixture', interval: '03:35', _types: { '320k': { size: '8M' } }, types: [{ type: '320k', size: '8M' }], meta: { _qualitys: { '320k': { size: '8M' } }, qualitys: [{ type: '320k', size: '8M' }] } }],
      total: 1,
      limit: 20,
      page: 1,
      source: 'fixture',
    })
  })

  it.each([
    ['id', { id: '', songmid: 'songmid-id' }, { id: 'songmid-id', songmid: 'songmid-id' }],
    ['songmid', { id: 'track-id', songmid: '' }, { id: 'track-id', songmid: 'track-id' }],
  ])('fills an empty %s from the other stable track identifier', (_field, item, expected) => {
    expect(SourceWorkerHost.normalizeSearchResult({
      list: [item], total: 1, limit: 20, page: 1, source: 'fixture',
    }).list).toEqual([expect.objectContaining(expected)])
  })

  it.each([
    ['empty', { id: '', songmid: '' }],
    ['missing', { name: 'Missing id' }],
  ])('rejects search items when both stable track identifiers are %s', (_case, item) => {
    expect(() => SourceWorkerHost.normalizeSearchResult({
      list: [item], total: 1, limit: 20, page: 1, source: 'fixture',
    })).toThrowError(expect.objectContaining({ code: 'SOURCE_PROTOCOL_ERROR' }))
  })

  it('does not expose the worker host process to a source script', async() => {
    const probe = script('VM isolation', `
window.lx.on(window.lx.EVENT_NAMES.request, async () => {
  try { window.constructor.constructor('return process')().pid; return { lyric: 'escaped' } } catch { return { lyric: 'blocked' } }
})
window.lx.send(window.lx.EVENT_NAMES.inited, { sources: { fixture: { type: 'music', actions: ['lyric'], qualitys: [] } } })`)
    const host = new SourceWorkerHost({ id: 'isolation', ...parseSourceScript(probe), script: probe })
    hosts.push(host)
    await expect(host.request({ source: 'fixture', action: 'lyric' })).resolves.toMatchObject({ lyric: 'blocked' })
  })

  it.each(['::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1', '::ffff:a00:1', '::ffff:169.254.1.1', '::ffff:a9fe:101', 'fe90::1', 'fea0::1', 'febf::1'])('blocks protected address %s before fetch', async(address) => {
    let contacted = false
    await expect(requestSourceNetwork('https://fixture.test/', {}, undefined, {
      lookup: async() => [address],
      fetch: async() => {
        contacted = true
        return new Response('unexpected')
      },
    })).rejects.toMatchObject({ code: 'SOURCE_TARGET_BLOCKED' })
    expect(contacted).toBe(false)
  })

  it('turns malformed source initialization into a recoverable protocol error', async() => {
    const malformed = script('Malformed init', 'window.lx.send(window.lx.EVENT_NAMES.inited, { sources: null })')
    const host = new SourceWorkerHost({ id: 'malformed', ...parseSourceScript(malformed), script: malformed })
    hosts.push(host)
    await expect(host.capabilities()).rejects.toMatchObject({ code: 'SOURCE_PROTOCOL_ERROR' })
  })

  it('wraps a custom musicUrl result in the renderer-compatible object shape', async() => {
    const host = new SourceWorkerHost({ id: 'url', ...parseSourceScript(fixtureScript), script: fixtureScript })
    hosts.push(host)
    await expect(host.request({ source: 'fixture', action: 'musicUrl' })).resolves.toEqual({ url: 'https://example.test/audio' })
  })

  it('forwards one validated source update alert', async() => {
    const alerts: unknown[] = []
    const alertSource = script('Update alert', `
window.lx.send(window.lx.EVENT_NAMES.updateAlert, { log: 'fixture update', updateUrl: 'https://example.test/update' })
window.lx.send(window.lx.EVENT_NAMES.updateAlert, { log: 'ignored' }).catch(() => {})
window.lx.send(window.lx.EVENT_NAMES.inited, { sources: { fixture: { type: 'music', actions: ['lyric'], qualitys: [] } } })`)
    const host = new SourceWorkerHost({ id: 'alert', ...parseSourceScript(alertSource), script: alertSource }, { onUpdateAlert: alert => alerts.push(alert) } as any)
    hosts.push(host)
    await host.capabilities()
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(alerts).toEqual([{ log: 'fixture update', updateUrl: 'https://example.test/update' }])
  })

  it('provides isolated LX crypto, buffer, and zlib utility behavior', async() => {
    const utilitySource = script('Utility compatibility', `
window.lx.on(window.lx.EVENT_NAMES.request, async () => {
  const value = window.lx.utils.buffer.from('hello')
  const packed = await window.lx.utils.zlib.deflate(value)
  const restored = await window.lx.utils.zlib.inflate(packed)
  const encrypted = window.lx.utils.crypto.aesEncrypt(value, 'aes-128-cbc', window.lx.utils.buffer.from('0123456789abcdef'), window.lx.utils.buffer.from('0123456789abcdef'))
  return { lyric: window.lx.utils.buffer.bufToString(restored, 'utf8') + ':' + window.lx.utils.crypto.md5('hello') + ':' + encrypted.length + ':' + window.lx.utils.crypto.randomBytes(8).toString('hex') }
})
window.lx.send(window.lx.EVENT_NAMES.inited, { sources: { fixture: { type: 'music', actions: ['lyric'], qualitys: [] } } })`)
    const host = new SourceWorkerHost({ id: 'utility', ...parseSourceScript(utilitySource), script: utilitySource })
    hosts.push(host)
    const result = await host.request<{ lyric: string }>({ source: 'fixture', action: 'lyric' })
    expect(result.lyric).toMatch(/^hello:5d41402abc4b2a76b9719d911017c592:16:[0-9a-f]{16}$/)
    expect(result.lyric.endsWith('0000000000000000')).toBe(false)
  })

  it('does not let a later invocation consume the previous entropy remainder', async() => {
    const entropySource = script('Entropy invocation isolation', `
window.lx.on(window.lx.EVENT_NAMES.request, async ({ info }) => {
  window.lx.utils.crypto.randomBytes(info.size)
  return { lyric: 'ok' }
})
window.lx.send(window.lx.EVENT_NAMES.inited, { sources: { fixture: { type: 'music', actions: ['lyric'], qualitys: [] } } })`)
    const host = new SourceWorkerHost({ id: 'entropy-isolation', ...parseSourceScript(entropySource), script: entropySource })
    hosts.push(host)
    await expect(host.request({ source: 'fixture', action: 'lyric', info: { size: 1 } })).resolves.toMatchObject({ lyric: 'ok' })
    await expect(host.request({ source: 'fixture', action: 'lyric', info: { size: 64 * 1024 + 1 } })).rejects.toMatchObject({ code: 'SOURCE_PROTOCOL_ERROR' })
  })

  it('rejects an entropy request larger than one invocation allowance', async() => {
    const entropySource = script('Entropy exhaustion', `
window.lx.on(window.lx.EVENT_NAMES.request, async () => {
  window.lx.utils.crypto.randomBytes(64 * 1024 + 1)
  return { lyric: 'unexpected' }
})
window.lx.send(window.lx.EVENT_NAMES.inited, { sources: { fixture: { type: 'music', actions: ['lyric'], qualitys: [] } } })`)
    const host = new SourceWorkerHost({ id: 'entropy-exhaustion', ...parseSourceScript(entropySource), script: entropySource })
    hosts.push(host)
    await expect(host.request({ source: 'fixture', action: 'lyric' })).rejects.toMatchObject({ code: 'SOURCE_PROTOCOL_ERROR' })
  })

  it('does not grow available entropy across repeated requests that consume none', async() => {
    const entropySource = script('Entropy bounded lifecycle', `
window.lx.on(window.lx.EVENT_NAMES.request, async ({ info }) => {
  if (info.consume) window.lx.utils.crypto.randomBytes(4 * 64 * 1024 + 1)
  return { lyric: 'ok' }
})
window.lx.send(window.lx.EVENT_NAMES.inited, { sources: { fixture: { type: 'music', actions: ['lyric'], qualitys: [] } } })`)
    const host = new SourceWorkerHost({ id: 'entropy-bounded', ...parseSourceScript(entropySource), script: entropySource })
    hosts.push(host)
    for (let request = 0; request < 4; request++) {
      await expect(host.request({ source: 'fixture', action: 'lyric', info: { consume: false } })).resolves.toMatchObject({ lyric: 'ok' })
    }
    await expect(host.request({ source: 'fixture', action: 'lyric', info: { consume: true } })).rejects.toMatchObject({ code: 'SOURCE_PROTOCOL_ERROR' })
  })

  it('keeps future invocations and entropy private from the active source handler', async() => {
    let markNetworkStarted: () => void = () => {}
    let releaseNetwork: () => void = () => {}
    const networkStarted = new Promise<void>(resolve => { markNetworkStarted = resolve })
    const networkResponse = new Promise<Response>(resolve => { releaseNetwork = () => { resolve(new Response('ok')) } })
    const stealingSource = script('Future invocation isolation', `
window.lx.on(window.lx.EVENT_NAMES.request, async ({ info }) => {
  if (info.phase === 'first') {
    await new Promise((resolve, reject) => window.lx.request('https://fixture.test/', {}, error => error ? reject(error) : resolve()))
    const globals = Object.getOwnPropertyNames(globalThis)
    let stolen = 0
    try { stolen = invocationQueue[0].entropy.splice(0).length } catch {}
    return { lyric: 'queue:' + typeof invocationQueue + '|entropy:' + typeof entropy + '|enumerated:' + (globals.includes('invocationQueue') || globals.includes('entropy')) + '|stolen:' + stolen }
  }
  window.lx.utils.crypto.randomBytes(64 * 1024)
  return { lyric: 'second:65536' }
})
window.lx.send(window.lx.EVENT_NAMES.inited, { sources: { fixture: { type: 'music', actions: ['lyric'], qualitys: [] } } })`)
    const host = new SourceWorkerHost({ id: 'future-invocation-isolation', ...parseSourceScript(stealingSource), script: stealingSource }, {
      network: {
        lookup: async() => ['203.0.113.1'],
        fetch: async() => { markNetworkStarted(); return await networkResponse },
      },
    })
    hosts.push(host)
    const first = host.request({ source: 'fixture', action: 'lyric', info: { phase: 'first' } })
    await networkStarted
    const second = host.request({ source: 'fixture', action: 'lyric', info: { phase: 'second' } })
    releaseNetwork()
    const [firstOutcome, secondOutcome] = await Promise.all([
      first.then(value => ({ value }), error => ({ error })),
      second.then(value => ({ value }), error => ({ error })),
    ])
    expect(firstOutcome).toEqual({ value: { lyric: 'queue:undefined|entropy:undefined|enumerated:false|stolen:0', tlyric: null, rlyric: null, lxlyric: null } })
    expect(secondOutcome).toEqual({ value: { lyric: 'second:65536', tlyric: null, rlyric: null, lxlyric: null } })
  })

  it('does not expose the current entropy array through patched VM prototypes', async() => {
    const prototypeProbe = script('Entropy prototype isolation', `
const leakedPools = []
const originalSplice = Array.prototype.splice
Array.prototype.splice = function(...args) {
  if (this.length === 64 * 1024) leakedPools.push(this)
  return originalSplice.apply(this, args)
}
window.lx.on(window.lx.EVENT_NAMES.request, async () => {
  window.lx.utils.crypto.randomBytes(1)
  if (leakedPools[0]) leakedPools[0].length = 0
  window.lx.utils.crypto.randomBytes(64 * 1024 - 1)
  return { lyric: 'private:' + leakedPools.length }
})
window.lx.send(window.lx.EVENT_NAMES.inited, { sources: { fixture: { type: 'music', actions: ['lyric'], qualitys: [] } } })`)
    const host = new SourceWorkerHost({ id: 'entropy-prototype-isolation', ...parseSourceScript(prototypeProbe), script: prototypeProbe })
    hosts.push(host)
    await expect(host.request({ source: 'fixture', action: 'lyric' })).resolves.toMatchObject({ lyric: 'private:0' })
  })

  it('does not complete a queued request from a forged inactive worker response', async() => {
    let markNetworkStarted: () => void = () => {}
    let releaseNetwork: () => void = () => {}
    const networkStarted = new Promise<void>(resolve => { markNetworkStarted = resolve })
    const networkResponse = new Promise<Response>(resolve => { releaseNetwork = () => { resolve(new Response('ok')) } })
    const adversarialSource = script('Active invocation response binding', `
let outbound
const originalPush = Array.prototype.push
Array.prototype.push = function(...args) {
  if (args.length === 1 && typeof args[0] === 'string' && args[0].includes('"type":"initialized"')) outbound = this
  return originalPush.apply(this, args)
}
window.lx.on(window.lx.EVENT_NAMES.request, async ({ info }) => {
  if (info.phase === 'first') {
    await new Promise((resolve, reject) => window.lx.request('https://fixture.test/', {}, error => {
      if (error) return reject(error)
      outbound.push(JSON.stringify({ type: 'response', id: 2, result: { lyric: 'forged-future' } }))
      resolve()
    }))
    return { lyric: 'first-real' }
  }
  return { lyric: 'second-real' }
})
window.lx.send(window.lx.EVENT_NAMES.inited, { sources: { fixture: { type: 'music', actions: ['lyric'], qualitys: [] } } })`)
    const host = new SourceWorkerHost({ id: 'active-response-binding', ...parseSourceScript(adversarialSource), script: adversarialSource }, {
      network: {
        lookup: async() => ['203.0.113.1'],
        fetch: async() => { markNetworkStarted(); return await networkResponse },
      },
    })
    hosts.push(host)
    const first = host.request({ source: 'fixture', action: 'lyric', info: { phase: 'first' } })
    await networkStarted
    const second = host.request({ source: 'fixture', action: 'lyric', info: { phase: 'second' } })
    releaseNetwork()
    await expect(first).resolves.toMatchObject({ lyric: 'first-real' })
    await expect(second).resolves.toMatchObject({ lyric: 'second-real' })
  })

  it('advances the host queue after synchronous and asynchronous non-protocol failures', async() => {
    const failureSource = script('Invocation failure cleanup', `
window.lx.on(window.lx.EVENT_NAMES.request, ({ info }) => {
  if (info.failure === 'sync') throw Object.assign(new Error('sync fixture failure'), { code: 'SOURCE_TARGET_BLOCKED' })
  if (info.failure === 'async') return Promise.reject(Object.assign(new Error('async fixture failure'), { code: 'SOURCE_RESPONSE_TOO_LARGE' }))
  window.lx.utils.crypto.randomBytes(64 * 1024)
  return { lyric: 'after-failures' }
})
window.lx.send(window.lx.EVENT_NAMES.inited, { sources: { fixture: { type: 'music', actions: ['lyric'], qualitys: [] } } })`)
    const host = new SourceWorkerHost({ id: 'failure-cleanup', ...parseSourceScript(failureSource), script: failureSource })
    hosts.push(host)
    const syncFailure = host.request({ source: 'fixture', action: 'lyric', info: { failure: 'sync' } })
    const asyncFailure = host.request({ source: 'fixture', action: 'lyric', info: { failure: 'async' } })
    const success = host.request({ source: 'fixture', action: 'lyric', info: {} })
    await expect(syncFailure).rejects.toMatchObject({ code: 'SOURCE_TARGET_BLOCKED' })
    await expect(asyncFailure).rejects.toMatchObject({ code: 'SOURCE_RESPONSE_TOO_LARGE' })
    await expect(success).resolves.toMatchObject({ lyric: 'after-failures' })
  })

  it('matches RSA_NO_PADDING encryption without exposing host crypto', async() => {
    const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 1024 })
    const key = publicKey.export({ type: 'spki', format: 'pem' }).toString()
    const expected = publicEncrypt({ key, padding: constants.RSA_NO_PADDING }, Buffer.concat([Buffer.alloc(125), Buffer.from('abc')])).toString('hex')
    const rsaSource = script('RSA compatibility', `
window.lx.on(window.lx.EVENT_NAMES.request, async () => ({ lyric: window.lx.utils.crypto.rsaEncrypt(window.lx.utils.buffer.from('abc'), ${JSON.stringify(key)}).toString('hex') }))
window.lx.send(window.lx.EVENT_NAMES.inited, { sources: { fixture: { type: 'music', actions: ['lyric'], qualitys: [] } } })`)
    const host = new SourceWorkerHost({ id: 'rsa', ...parseSourceScript(rsaSource), script: rsaSource })
    hosts.push(host)
    await expect(host.request({ source: 'fixture', action: 'lyric' })).resolves.toMatchObject({ lyric: expected })
  })

  it.each(['SOURCE_TARGET_BLOCKED', 'SOURCE_RESPONSE_TOO_LARGE'] as const)('preserves network failure code %s through lx.request', async(code) => {
    const networkSource = script(`Network ${code}`, `
window.lx.on(window.lx.EVENT_NAMES.request, ({ action }) => new Promise((resolve, reject) => {
  window.lx.request('https://fixture.test/', {}, (error) => error ? reject(error) : resolve(action === 'lyric' ? { lyric: 'ok' } : 'https://example.test/value'))
}))
window.lx.send(window.lx.EVENT_NAMES.inited, { sources: { fixture: { type: 'music', actions: ['lyric'], qualitys: [] } } })`)
    const host = new SourceWorkerHost({ id: code, ...parseSourceScript(networkSource), script: networkSource }, {
      network: code === 'SOURCE_TARGET_BLOCKED'
        ? { lookup: async() => ['127.0.0.1'] }
        : { lookup: async() => ['203.0.113.1'], fetch: async() => new Response(new Uint8Array(8 * 1024 * 1024 + 1)) },
    })
    hosts.push(host)
    await expect(host.request({ source: 'fixture', action: 'lyric' })).rejects.toMatchObject({ code })
  })

  it('aborts the underlying source network work on cancellation', async() => {
    let networkAborted = false
    let markStarted: () => void = () => {}
    const started = new Promise<void>(resolve => { markStarted = resolve })
    const networkSource = script('Cancelable network', `
window.lx.on(window.lx.EVENT_NAMES.request, () => new Promise((resolve, reject) => window.lx.request('https://fixture.test/', {}, error => error ? reject(error) : resolve({ lyric: 'ok' }))))
window.lx.send(window.lx.EVENT_NAMES.inited, { sources: { fixture: { type: 'music', actions: ['lyric'], qualitys: [] } } })`)
    const host = new SourceWorkerHost({ id: 'network-cancel', ...parseSourceScript(networkSource), script: networkSource }, {
      network: {
        lookup: async() => ['203.0.113.1'],
        fetch: async(_url, init) => await new Promise<Response>((_resolve, reject) => { markStarted(); init.signal!.addEventListener('abort', () => { networkAborted = true; reject(new DOMException('aborted', 'AbortError')) }) }),
      },
    })
    hosts.push(host)
    const controller = new AbortController()
    const pending = host.request({ source: 'fixture', action: 'lyric' }, controller.signal)
    await started
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'SOURCE_CANCELLED' })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(networkAborted).toBe(true)
  })

  it('isolates stale worker callbacks across repeated cancel-and-restart requests', async() => {
    let calls = 0
    let notifyStarted: () => void = () => {}
    const source = script('Restart isolation', `
window.lx.on(window.lx.EVENT_NAMES.request, () => new Promise((resolve, reject) => window.lx.request('https://fixture.test/', {}, error => error ? reject(error) : resolve({ lyric: 'ok' }))))
window.lx.send(window.lx.EVENT_NAMES.inited, { sources: { fixture: { type: 'music', actions: ['lyric'], qualitys: [] } } })`)
    const host = new SourceWorkerHost({ id: 'restart', ...parseSourceScript(source), script: source }, {
      network: {
        lookup: async() => ['203.0.113.1'],
        fetch: async(_url, init) => {
          calls++
          if (calls % 2 === 0) return new Response('ok')
          return await new Promise<Response>((_resolve, reject) => {
            notifyStarted()
            init.signal!.addEventListener('abort', () => { reject(new DOMException('aborted', 'AbortError')) })
          })
        },
      },
    })
    hosts.push(host)
    for (let attempt = 0; attempt < 5; attempt++) {
      const started = new Promise<void>(resolve => { notifyStarted = resolve })
      const controller = new AbortController()
      const cancelled = host.request({ source: 'fixture', action: 'lyric' }, controller.signal)
      await started
      controller.abort()
      await expect(cancelled).rejects.toMatchObject({ code: 'SOURCE_CANCELLED' })
      await expect(host.request({ source: 'fixture', action: 'lyric' })).resolves.toMatchObject({ lyric: 'ok' })
    }
    expect(calls).toBe(10)
  })
})
