const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')
const { buildSync } = require('../apps/service/node_modules/esbuild')
const fixture = () => {
  const root = path.resolve(__dirname, '..')
  const output = buildSync({ stdin: { contents: "export * from './packages/service-client/src/client'; export * from './packages/service-client/src/accounts'; export * from './packages/music-core/src/sharedAccountSync'", resolveDir: root }, bundle: true, write: false, format: 'cjs', platform: 'node' }).outputFiles[0].text
  const filename = path.join(root, 'contract-fixture.cjs')
  const loaded = new Module(filename); loaded._compile(output, filename)
  const api = loaded.exports; const storage = new Map()
  api.configureAccountAccessStorage({ get: async endpoint => storage.get(endpoint) ?? null, set: async(endpoint, token) => { storage.set(endpoint, token) }, remove: async endpoint => { storage.delete(endpoint) } })
  return { ...api, storage }
}
test('device tokens are scoped to a server and account routes; stream/playback requests never carry them', async() => {
  const api = fixture(); const calls = []
  await api.accountAccess.set('https://one.example', 'synthetic-device-token')
  const transport = async(url, options) => { calls.push({ url, options }); return Response.json({ data: {} }) }
  const one = new api.ServiceClient('https://one.example', transport); const other = new api.ServiceClient('https://other.example', transport)
  await api.sharedAccounts(one).status(); await one.request('/api/v1/playback/tracks/resolve', 'POST', {}); await api.sharedAccounts(other).status()
  assert.equal(calls[0].options.headers.Authorization, 'Bearer synthetic-device-token')
  assert.equal(calls[0].options.redirect, 'error')
  assert.equal(calls[1].options.headers.Authorization, undefined)
  assert.equal(calls[2].options.headers.Authorization, undefined)
  await api.sharedAccounts(one).disconnect(); assert.equal(api.storage.size, 0)
})
test('password login persists only the session token and does not return it to account UI consumers', async() => {
  const api = fixture()
  const client = new api.ServiceClient('https://fixture', async(_url, options) => {
    assert.equal(JSON.parse(options.body).password, 'fixture-password')
    return Response.json({ data: { token: 'synthetic-device-token', serverId: 'fixture-server', device: { id: 'fixture-device' } } })
  })
  const result = await api.sharedAccounts(client).signIn('fixture-password', 'fixture')
  assert.equal(result.token, undefined); assert.equal(api.storage.get('https://fixture'), 'synthetic-device-token')
})
test('HTTP supports password login and scoped account reads directly, without policy probes or switches', async() => {
  const api = fixture(); const calls = []
  const transport = async(url, options) => {
    calls.push({ url, options })
    if (url.endsWith('/login')) return Response.json({ data: { token: 'synthetic-token', serverId: 'demo', device: { id: 'fixture' } } })
    return Response.json({ data: { tx: true } })
  }
  const client = new api.ServiceClient('http://192.168.0.70:3125', transport)
  await api.sharedAccounts(client).signIn('synthetic-password', 'fixture'); await api.sharedAccounts(client).status()
  assert.equal(calls.length, 2); assert.equal(calls[0].url, client.endpoint + '/api/v1/access/login'); assert.equal(calls[0].options.headers.Authorization, undefined)
  assert.equal(JSON.parse(calls[0].options.body).password, 'synthetic-password'); assert.equal(calls[1].options.headers.Authorization, 'Bearer synthetic-token')
  const other = new api.ServiceClient('http://192.168.0.70:3124', transport)
  await api.sharedAccounts(other).status(); assert.equal(calls[2].options.headers.Authorization, undefined)
})
test('revocation clears the captured device token, while transient failures preserve authorization', async() => {
  const api = fixture(); const endpoint = 'https://fixture'
  await api.accountAccess.set(endpoint, 'synthetic-device-token')
  const unavailable = new api.ServiceClient(endpoint, async() => { throw new Error('synthetic network failure') })
  assert.deepEqual(await api.probeAccountAccess(unavailable), { state: 'unavailable' })
  assert.equal(api.storage.get(endpoint), 'synthetic-device-token')
  const revoked = new api.ServiceClient(endpoint, async() => Response.json({ error: { code: 'DEVICE_AUTH_REQUIRED', message: 'synthetic' } }, { status: 401 }))
  assert.deepEqual(await api.probeAccountAccess(revoked), { state: 'locked' })
  assert.equal(api.storage.has(endpoint), false)
})
test('signing out revokes the server session and clears only the captured authorization', async() => {
  const api = fixture(); const endpoint = 'https://fixture'
  await api.accountAccess.set(endpoint, 'old-session')
  const client = new api.ServiceClient(endpoint, async(url, options) => {
    assert.equal(url, endpoint + '/api/v1/access/session'); assert.equal(options.method, 'DELETE')
    await api.accountAccess.set(endpoint, 'new-session')
    return Response.json({ data: { signedOut: true } })
  })
  await api.sharedAccounts(client).signOut()
  assert.equal(await api.accountAccess.get(endpoint), 'new-session')
})
test('account transport works when React Native URL getters are unavailable', async() => {
  const api = fixture(); const OriginalURL = global.URL
  global.URL = class { constructor() { throw new Error('URL.hostname is not implemented') } }
  try {
    const client = new api.ServiceClient('http://127.0.0.1:58930', async() => Response.json({ data: { tx: true } }))
    assert.equal((await api.sharedAccounts(client).status()).tx, true)
    assert.equal(api.normalizeEndpoint('http://192.168.0.70:3125'), 'http://192.168.0.70:3125')
    assert.throws(() => api.normalizeEndpoint('javascript:invalid'), { code: 'INVALID_SERVER_ADDRESS' })
  } finally { global.URL = OriginalURL }
})
test('favorite sync refreshes only an existing owner-scoped imported list and never creates one', async() => {
  const api = fixture(); const calls = []; const owner = 'a'.repeat(32)
  const client = new api.ServiceClient('https://fixture', async(url, options) => {
    calls.push({ url, options })
    return Response.json({ data: url.endsWith('/status') ? { tx: true, accounts: { tx: { importOwner: owner } }, revisions: { tx: 3 } } : { id: 'fixture', count: 1 } })
  })
  assert.deepEqual(await api.syncSharedQQFavorites({ client, playlists: async() => [] }), { total: 0, failed: 0 })
  assert.equal(calls.length, 1)
  assert.deepEqual(await api.syncSharedQQFavorites({ client, playlists: async() => [{ id: `account_tx_${owner}_dir_201` }] }), { total: 1, failed: 0 })
  assert.equal(calls.length, 3)
  assert.deepEqual(JSON.parse(calls[2].options.body), { id: 'dir:201', revision: 3 })
})
