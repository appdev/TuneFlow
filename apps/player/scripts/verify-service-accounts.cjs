const readSource = require('../../../scripts/read-source.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const { createHash } = require('node:crypto')
const root = path.resolve(__dirname, '..')
const mobileRoot = path.resolve(root, '../android')
function load(file, dependencies = {}, globals = {}) {
  const context = { exports: {}, Error, URL, AbortController, AbortSignal, setTimeout, clearTimeout, fetch, console, ...globals, require: name => {
    if (!(name in dependencies)) throw Error(`Missing dependency ${name}`)
    return dependencies[name]
  } }
  vm.runInNewContext(ts.transpileModule(readSource(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, context)
  return context.exports
}
function domain(base, prefix) {
  const folder = path.join(base, prefix)
  const api = load(path.join(folder, 'client.ts'))
  const tracks = load(path.join(folder, 'tracks.ts'), { './client': api })
  const workspace = load(path.join(folder, 'workspace.ts'), { './client': api, './tracks': tracks })
  const accounts = load(path.join(folder, 'accountLibrary.ts'), { './client': api })
  return { api, tracks, workspace, accounts }
}
const desktop = domain(root, 'src/renderer/service')
const mobile = domain(mobileRoot, 'src/service')
const owner = createHash('md5').update('qq:2:123').digest('hex')
const collection = { provider: 'tx', owner, id: 'dir:201', name: 'Account playlist' }
const song = { id: 'tx_mid', source: 'tx', name: 'Song', singer: 'Artist', interval: '03:00', url: 'https://official/private', cookies: 'private-test-value', meta: { songId: 'mid', strMediaMid: 'media', albumName: 'Album', cookie: 'private-test-value', officialUrl: 'https://official/private', toggleMusicInfo: { id: 'bypass' }, qualitys: [{ type: '128k', size: '1M' }] } }

test('both clients serialize only song metadata, force Service provenance, and reject cross-server/device tracks', async() => {
  for (const item of [desktop, mobile]) {
    const workspace = new item.workspace.ServiceWorkspace(new item.api.ServiceClient('http://fixture', async() => ({ ok: true, status: 200, json: async() => ({ data: { url: '/api/v1/streams/opaque', quality: '128k' } }) })))
    const converted = item.accounts.accountTrack(workspace, song)
    const dto = workspace.original(converted)
    assert.equal(converted.meta.service.endpoint, 'http://fixture')
    assert.equal(dto.meta.songId, 'mid')
    assert.equal(dto.meta.strMediaMid, 'media')
    assert.ok(!JSON.stringify(dto).includes('private-test-value'))
    assert.ok(!JSON.stringify(dto).includes('official'))
    assert.equal(dto.meta.toggleMusicInfo, undefined)
    assert.throws(() => item.accounts.accountTrack(workspace, item.tracks.toServiceTrack(song, 'http://other')), { code: 'DIFFERENT_SERVER' })
    assert.throws(() => item.accounts.accountTrack(workspace, { id: 'file', source: 'local', meta: { filePath: '/private/song' } }), { code: 'DEVICE_FILE_NOT_IN_SERVER_LIBRARY' })
  }
})

test('same account/playlist namespace agrees across clients; different owners are isolated; Kugou native identifiers normalize', () => {
  assert.equal(desktop.accounts.accountCollectionId(collection), mobile.accounts.accountCollectionId(collection))
  assert.notEqual(desktop.accounts.accountCollectionId(collection), mobile.accounts.accountCollectionId({ ...collection, owner: 'f'.repeat(32) }))
  assert.equal(desktop.accounts.accountCollectionId({ ...collection, provider: 'kg', id: 'account:123:7' }), mobile.accounts.accountCollectionId({ ...collection, provider: 'kg', id: '7' }))
  assert.throws(() => desktop.accounts.accountCollectionId({ ...collection, owner: 'cookie' }), { code: 'INVALID_ACCOUNT_COLLECTION' })
})

test('additive import preserves server edits; account/server cancellation before writes has no side effects', async() => {
  const calls = []
  const workspace = {
    original: value => value,
    native: value => desktop.tracks.toServiceTrack(value, 'http://fixture'),
    playlists: async() => [],
    lists: async(name, body) => { calls.push({ name, body }) },
  }
  let checks = 0
  await assert.rejects(desktop.accounts.importAccountCollection(workspace, collection, [song], async() => { if (++checks === 2) throw new Error('account_changed') }), /account_changed/)
  assert.equal(calls.length, 0)
  await desktop.accounts.importAccountCollection(workspace, collection, [song], async() => {})
  assert.equal(calls[0].name, 'add')
  assert.equal(calls[1].name, 'music_add')
  assert.ok(!calls.some(item => /overwrite|clear|remove/.test(item.name)))
  assert.ok(!JSON.stringify(calls).includes('private-test-value'))
})

test('Android native account imports route only to Service and do not enable legacy automatic overwrites', async() => {
  let imports = 0
  let done
  const gate = new Promise(resolve => { done = resolve })
  const api = load(path.join(mobileRoot, 'src/core/musicAccount/playlistSync.ts'), {
    '@/store/list/state': { userList: [] }, '@/core/list': {}, '@/utils/data': {}, '@/utils/playlistMerge': {}, './qqCredentials': {}, './syncState': {}, './playlists': {},
    '@/service/session': { isServiceMode: () => true },
    '@/service/accounts': { accountPlaylistId: () => 'stable', importMobileAccountPlaylist: async() => { imports++; await gate; return { id: 'stable', count: 1 } } },
  })
  const first = api.syncAccountPlaylist({}, { id: '201' })
  const second = api.syncAccountPlaylist({}, { id: '201' })
  done(); await Promise.all([first, second]); assert.equal(imports, 1)
  await assert.rejects(api.syncAccountPlaylist({}, {}, undefined, undefined, true), /cancelled/)
})

test('Android owner fingerprint matches desktop namespace and personal recommendations disable device fallback', async() => {
  const qq = load(path.join(mobileRoot, 'src/core/musicAccount/qqCredentials.ts'))
  const workspace = new mobile.workspace.ServiceWorkspace(new mobile.api.ServiceClient('http://fixture'))
  let fallback
  const accounts = load(path.join(mobileRoot, 'src/service/accounts.ts'), {
    '@/utils/musicSdk/utils': { toMD5: text => createHash('md5').update(text).digest('hex') },
    '@/core/musicAccount/qqCredentials': qq,
    '@/core/musicAccount/daily': { getAccountDaily: async(_p, _f, _s, allowFallback) => { fallback = allowFallback; return { list: [song], kind: 'radar' } } },
    '@/core/musicAccount/playlists': {}, './accountLibrary': mobile.accounts, './session': { getWorkspace: () => workspace }, './client': mobile.api,
  })
  assert.equal(accounts.accountOwner({ provider: 'tx', cookies: { qqmusic_uin: '123', login_type: '1' } }), owner)
  const result = await accounts.loadMobileAccountDaily('tx', true)
  assert.equal(fallback, false)
  assert.equal(result.list[0].meta.service.endpoint, 'http://fixture')
})
