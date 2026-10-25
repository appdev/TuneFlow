const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const mobileRoot = path.resolve(root, '../qmusic-client')
function load(file, dependencies = {}, globals = {}) {
  const context = { exports: {}, Error, URL, AbortController, setTimeout, clearTimeout, fetch, console, ...globals, require: name => {
    if (!(name in dependencies)) throw Error(`Missing dependency ${name}`)
    return dependencies[name]
  } }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, context)
  return context.exports
}
function domain(base, prefix) {
  const folder = path.join(base, prefix)
  const api = load(path.join(folder, 'client.ts'))
  const tracks = load(path.join(folder, 'tracks.ts'), { './client': api })
  const workspace = load(path.join(folder, 'workspace.ts'), { './client': api, './tracks': tracks })
  const recommendations = load(path.join(folder, 'recommendations.ts'), { './client': api })
  return { folder, api, tracks, workspace, recommendations }
}
const clients = [domain(root, 'src/renderer/service'), domain(mobileRoot, 'src/service')]
const song = { id: 'tx_mid', source: 'tx', name: 'Song', singer: 'Artist', interval: '03:00', meta: { songId: 'mid', albumName: 'Album', qualitys: [{ type: '128k', size: '1M' }] } }

for (const [index, client] of clients.entries()) {
  const name = index ? 'Android' : 'desktop'
  test(`${name}: personal daily wins; force bypasses account cache without refreshing Docker`, async() => {
    let forced
    const workspace = new client.workspace.ServiceWorkspace(new client.api.ServiceClient('http://fixture', () => { throw Error('unexpected Service call') }))
    const list = [workspace.native(song)]
    const value = await client.recommendations.loadDailyFeed(workspace, 'tx', async(_source, force) => { forced = force; return { list, kind: 'official_daily' } }, true)
    assert.equal(forced, true)
    assert.equal(value.origin, 'account')
    assert.equal(value.kind, 'official_daily')
    assert.equal(value.list[0].meta.service.endpoint, 'http://fixture')
  })
  test(`${name}: account unavailable falls back; refresh POST precedes snapshot GET, update GET never creates another batch`, async() => {
    const calls = []
    let version = 1
    const workspace = new client.workspace.ServiceWorkspace(new client.api.ServiceClient('http://fixture', async(url, init) => {
      calls.push([url.split('/api/v1/')[1], init.method])
      if (init.method === 'POST') { version++; return { ok: true, status: 202, json: async() => ({ data: { status: 'generating', generationId: 'g' } }) } }
      return { ok: true, status: 200, json: async() => ({ data: { status: 'ready', version, items: [{ track: song, recommendationItemId: 'item-' + version }] } }) }
    }))
    const personal = async() => ({ list: [], reason: 'login_required' })
    const first = await client.recommendations.loadDailyFeed(workspace, 'tx', personal)
    const second = await client.recommendations.loadDailyFeed(workspace, 'tx', personal, true)
    const update = await client.recommendations.loadDailyFeed(workspace, 'server', personal)
    assert.equal(first.origin, 'server'); assert.equal(first.reason, 'login_required')
    assert.equal(first.version, 1); assert.equal(second.version, 2); assert.equal(update.version, 2)
    assert.equal(second.list[0].meta.service.recommendationItemId, 'item-2')
    assert.equal(calls.map(call => call.join(':')).join(','), 'recommendations/daily:GET,recommendations/daily/refresh:POST,recommendations/daily:GET,recommendations/daily:GET')
  })
  test(`${name}: cancellation and account switch prevent fallback mutation; transient provider failure still falls back`, async() => {
    let calls = 0
    const workspace = new client.workspace.ServiceWorkspace(new client.api.ServiceClient('http://fixture', async() => { calls++; return { ok: true, status: 200, json: async() => ({ data: { status: 'warming', items: [] } }) } }))
    const controller = new AbortController()
    await assert.rejects(client.recommendations.loadDailyFeed(workspace, 'tx', async() => { controller.abort(); throw Error('late') }, true, controller.signal), { code: 'CANCELLED' })
    for (const code of ['ACCOUNT_CHANGED', 'SERVER_CHANGED', 'CANCELLED']) {
      await assert.rejects(client.recommendations.loadDailyFeed(workspace, 'tx', async() => { throw new client.api.ServiceError(code) }, true), { code })
    }
    assert.equal(calls, 0)
    const result = await client.recommendations.loadDailyFeed(workspace, 'tx', async() => { throw Error('network') })
    assert.equal(result.origin, 'server'); assert.equal(result.status, 'warming'); assert.equal(calls, 1)
  })
  test(`${name}: snapshot recommendation updates deduplicate independently of playlist/playback events and unsubscribe`, async() => {
    let snapshot = { sequence: 1, events: [{ type: 'recommendations.updated', sequence: 1 }] }
    class FakeClient {
      constructor(endpoint) { this.endpoint = endpoint }
      async connect() {}
      async request() { return snapshot }
      async settings() { return {} }
    }
    class FakeWorkspace {
      constructor(client) { this.client = client }
      async playlists() { return [] }
      async tracks() { return [] }
    }
    const session = load(path.join(client.folder, 'session.ts'), {
      './client': { ServiceClient: FakeClient },
      './workspace': { ServiceWorkspace: FakeWorkspace, DEFAULT_ENDPOINT: 'http://fixture' },
      '@react-native-async-storage/async-storage': { setItem: async() => {} },
    }, { localStorage: { getItem: () => null } })
    let updates = 0
    const unsubscribe = session.subscribeRecommendations(() => { updates++ })
    await session.checkService(); assert.equal(updates, 1)
    await session.checkService(); assert.equal(updates, 1)
    snapshot = { ...snapshot, sequence: 2 }
    await session.checkService(); assert.equal(updates, 1)
    snapshot = { sequence: 3, events: [{ type: 'recommendations.updated', sequence: 3 }] }
    await session.checkService(); assert.equal(updates, 2)
    if (index) { await session.connectService('http://other', async() => {}); assert.equal(updates, 3, 'new endpoint owns its event sequence') }
    unsubscribe(); snapshot = { sequence: 4, events: [{ type: 'recommendations.updated', sequence: 4 }] }
    await session.checkService(); assert.equal(updates, index ? 3 : 2)
  })
}

test('desktop QQ: one metadata rejection and one missing song preserve remaining songs; ownership guard still rejects account changes', async() => {
  const client = clients[0]
  const workspace = new client.workspace.ServiceWorkspace(new client.api.ServiceClient('http://fixture'))
  let valid = true
  const accountLibrary = load(path.join(client.folder, 'accountLibrary.ts'), { './client': client.api })
  const accounts = load(path.join(client.folder, 'accounts.ts'), {
    '@renderer/utils/ipc': {
      getMusicAccountDaily: async() => ({ status: 'personalized', kind: 'radar', importOwner: 'owner', ids: ['ok', 'bad', 'missing', 'ok2'] }),
      getMusicAccountStatus: async() => ({ tx: valid, accounts: { tx: { importOwner: 'owner' } } }),
    },
    '@renderer/views/List/MyList/importPlaylist': {},
    '@renderer/utils/musicSdk/tx/musicInfo': async id => { if (id === 'bad') throw Error('metadata failed'); return id === 'missing' ? null : { ...song, id: 'tx_' + id } },
    '@renderer/utils/musicSdk/wy/musicDetail': {}, '@renderer/utils': { toNewMusicInfo: value => value },
    './session': { getWorkspace: () => workspace }, './accountLibrary': accountLibrary, './client': client.api,
  })
  const result = await accounts.loadDesktopAccountDaily('tx')
  assert.equal(result.list.length, 2); assert.equal(result.status, 'radar')
  assert.ok(result.list.every(track => track.meta.service.endpoint === 'http://fixture'))
  valid = false
  await assert.rejects(accounts.loadDesktopAccountDaily('tx'), { code: 'ACCOUNT_CHANGED' })
})

test('desktop homepage keeps songs on transient refresh failure, clears changed accounts and ignores late source responses', async() => {
  const client = clients[0]
  const compiler = require('@vue/compiler-sfc')
  const filename = path.join(client.folder, 'ServerHome.vue')
  const script = compiler.compileScript(compiler.parse(fs.readFileSync(filename, 'utf8')).descriptor, { id: 'home-state-test' }).content
  let next = async() => ({ list: [song], origin: 'account', kind: 'radar', status: 'ready', reason: '' })
  const vue = {
    defineComponent: value => value,
    ref: value => ({ value }), shallowRef: value => ({ value }),
    computed: getter => ({ get value() { return getter() } }),
    watch: (_getter, callback) => { callback(true) }, onBeforeUnmount: () => {},
  }
  const dependencies = {
    vue, '@common/utils/vueRouter': { useRouter: () => ({ push: async() => {} }) },
    '@renderer/utils/ipc': { getMusicAccountStatus: async() => undefined },
    '@renderer/components/common/SourceIcon.vue': {},
    '@renderer/core/music': { getPicPath: async() => '' }, '@renderer/core/player/selection': {},
    '@renderer/core/player/action': {}, '@renderer/store/player/state': { playMusicInfo: {} },
    './session': { getWorkspace: () => workspace, serviceStatus: {}, subscribeService: () => () => {}, subscribeRecommendations: () => () => {} },
    './accounts': { accountNames: { tx: 'QQ', wy: 'WY', kg: 'KG' } },
    './recommendations': { ...client.recommendations, loadDailyFeed: async(...args) => next(...args) }, './client': client.api,
  }
  const workspace = { client: { endpoint: 'http://fixture' } }
  const context = {
    exports: {}, Error, AbortController, process: { platform: 'darwin' },
    localStorage: { getItem: () => 'tx', setItem: () => {} },
    window: { i18n: { locale: 'zh-CN' }, addEventListener: () => {}, removeEventListener: () => {} },
    require: name => { if (!(name in dependencies)) throw Error('Missing ' + name); return dependencies[name] },
  }
  vm.runInNewContext(ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, context)
  const home = context.exports.default.setup({ visible: true }, { expose: () => {} })
  const flush = async() => { await new Promise(resolve => setImmediate(resolve)) }
  await flush(); assert.equal(home.dailyRecommendList.value.length, 1)
  next = async() => { throw Error('offline') }
  await home.loadDailyRecommend(true); assert.equal(home.dailyRecommendList.value.length, 1)
  next = async() => { throw new client.api.ServiceError('ACCOUNT_CHANGED') }
  await home.loadDailyRecommend(); assert.equal(home.dailyRecommendList.value.length, 0)
  let finishOld
  next = async(_workspace, source) => source === 'tx' ? new Promise(resolve => { finishOld = resolve }) : { list: [{ ...song, id: 'wy_new' }], origin: 'account', status: 'ready' }
  const old = home.loadDailyRecommend()
  home.selectDailyProvider('wy'); await flush()
  finishOld({ list: [{ ...song, id: 'tx_stale' }], origin: 'account', status: 'ready' }); await old
  assert.equal(home.dailyRecommendList.value[0].id, 'wy_new')
})
