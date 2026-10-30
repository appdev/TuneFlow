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
  return loaded.exports
}
test('account reads need no password or authorization; QR identifiers are scoped to each client', async() => {
  const api = fixture(); const calls = []
  const transport = async(url, options) => { calls.push({ url, options }); return Response.json({ data: { tx: true } }) }
  const one = new api.ServiceClient('https://one.example', transport); const other = new api.ServiceClient('https://other.example', transport)
  await api.sharedAccounts(one).status(); await one.request('/api/v1/playback/tracks/resolve', 'POST', {}); await api.sharedAccounts(other).status(); await api.sharedAccounts(one).login('tx')
  for (const call of calls) assert.equal(call.options.headers.Authorization, undefined)
  assert.equal(calls[0].options.redirect, 'error')
  assert.match(calls[0].options.headers['X-TuneFlow-Client-Id'], /^[A-Za-z0-9_-]{8,80}$/)
  assert.equal(calls[1].options.headers['X-TuneFlow-Client-Id'], undefined)
  assert.notEqual(calls[0].options.headers['X-TuneFlow-Client-Id'], calls[2].options.headers['X-TuneFlow-Client-Id'])
  assert.equal(calls[0].options.headers['X-TuneFlow-Client-Id'], calls[3].options.headers['X-TuneFlow-Client-Id'])
})
test('account availability probes work without stored tokens and distinguish network failures', async() => {
  const api = fixture()
  const available = new api.ServiceClient('http://fixture', async() => Response.json({ data: { serverId: 'fixture-server' } }))
  assert.deepEqual(await api.probeAccountAccess(available), { state: 'authorized', serverId: 'fixture-server' })
  const unavailable = new api.ServiceClient('http://fixture', async() => { throw new Error('fixture network failure') })
  assert.deepEqual(await api.probeAccountAccess(unavailable), { state: 'unavailable' })
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
