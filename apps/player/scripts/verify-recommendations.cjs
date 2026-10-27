const readSource = require('../../../scripts/read-source.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const mobileRoot = path.resolve(root, '../android')
function load(file, dependencies = {}, globals = {}) {
  const context = { exports: {}, Error, URL, AbortController, setTimeout, clearTimeout, fetch, console, ...globals, require: name => {
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
  const recommendations = load(path.join(folder, 'recommendations.ts'), { './client': api })
  return { folder, api, tracks, workspace, recommendations }
}
const clients = [domain(root, 'src/renderer/service'), domain(mobileRoot, 'src/service')]
const song = { id: 'tx_mid', source: 'tx', name: 'Song', singer: 'Artist', interval: '03:00', meta: { songId: 'mid', albumName: 'Album', qualitys: [{ type: '128k', size: '1M' }] } }

for (const [index, client] of clients.entries()) {
  const name = index ? 'Android' : 'desktop'
  test(`${name}: anonymous providers use public playlists, refresh changes selection, and public feeds never claim personalization`, async() => {
    for (const source of ['tx', 'wy', 'kg']) {
      const calls = []
      const workspace = new client.workspace.ServiceWorkspace(new client.api.ServiceClient('http://fixture', async(url, init) => {
        const body = JSON.parse(init.body); calls.push({ url, body })
        const data = url.endsWith('/browse') ? { list: [{ id: 'one' }, { id: 'two' }] } : { tracks: [{ ...song, source, id: body.playlistId }] }
        return { ok: true, status: 200, json: async() => ({ data }) }
      }))
      const personal = async() => ({ list: [], status: 'login_required' })
      const first = await client.recommendations.loadDailyFeed(workspace, source, personal)
      const second = await client.recommendations.loadDailyFeed(workspace, source, personal, true)
      assert.equal(first.origin, 'public'); assert.equal(first.kind, source + '_public')
      assert.notEqual(first.list[0].id, second.list[0].id)
      assert.equal(calls.filter(call => call.url.includes('/recommendations/')).length, 0)
      assert.doesNotMatch(client.recommendations.dailyFeedNotice(first), /Docker|未登录|个人|账号偏好/)
      assert.ok(first.list.every(track => track.meta.service.endpoint === 'http://fixture'))
    }
  })
  test(`${name}: snapshot cache separates source, account, endpoint, day and freshness; update invalidation preserves public feeds`, () => {
    const a = new client.workspace.ServiceWorkspace(new client.api.ServiceClient('http://one'))
    const b = new client.workspace.ServiceWorkspace(new client.api.ServiceClient('http://two'))
    const feed = { list: [song], origin: 'public', kind: 'tx_public', status: 'ready', reason: '' }
    const { cacheDailyFeed, readDailyFeedCache, clearDailyFeedCache } = client.recommendations
    cacheDailyFeed(a, 'tx', 'owner-one', feed, ['cover'])
    assert.equal(readDailyFeedCache(a, 'tx', 'owner-one').covers[0], 'cover')
    assert.equal(readDailyFeedCache(a, 'wy', 'owner-one'), undefined)
    assert.equal(readDailyFeedCache(b, 'tx', 'owner-one'), undefined)
    clearDailyFeedCache(a, 'server')
    assert.equal(readDailyFeedCache(a, 'tx', 'owner-one').feed, feed)
    assert.equal(readDailyFeedCache(a, 'tx', 'owner-two'), undefined)
    cacheDailyFeed(a, 'tx', 'owner-one', feed)
    readDailyFeedCache(a, 'tx', 'owner-one').savedAt -= 15 * 60_000
    assert.equal(readDailyFeedCache(a, 'tx', 'owner-one'), undefined)
    cacheDailyFeed(a, 'tx', 'owner-one', feed)
    readDailyFeedCache(a, 'tx', 'owner-one').day = 'previous day'
    assert.equal(readDailyFeedCache(a, 'tx', 'owner-one'), undefined)
    cacheDailyFeed(a, 'server', '', { ...feed, origin: 'server' })
    clearDailyFeedCache(a, 'server')
    assert.equal(readDailyFeedCache(a, 'server', ''), undefined)
  })
  test(`${name}: a safety block in public catalog loading remains terminal`, async() => {
    let calls = 0
    const workspace = new client.workspace.ServiceWorkspace(new client.api.ServiceClient('http://fixture', async() => { calls++; return { ok: false, status: 403, json: async() => ({ error: { code: 'SOURCE_TARGET_BLOCKED' } }) } }))
    await assert.rejects(client.recommendations.loadDailyFeed(workspace, 'tx', async() => ({ list: [], status: 'login_required' })), { code: 'SOURCE_TARGET_BLOCKED' })
    assert.equal(calls, 1)
  })
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
      if (url.includes('/catalog/')) return { ok: true, status: 200, json: async() => ({ data: { list: [] } }) }
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
    assert.equal(calls.map(call => call.join(':')).join(','), 'catalog/playlists/browse:POST,recommendations/daily:GET,catalog/playlists/browse:POST,recommendations/daily/refresh:POST,recommendations/daily:GET,recommendations/daily:GET')
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
    assert.equal(result.origin, 'server'); assert.equal(result.status, 'warming'); assert.equal(calls, 2)
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
      [index ? '../../../../packages/service-client/src/connection' : '../../../../../packages/service-client/src/connection']: load(path.resolve(root, '../../packages/service-client/src/connection.ts')),
      'react-native': { AppState: { addEventListener() {} } },
      [index ? '../../../../packages/service-client/src/accounts' : '../../../../../packages/service-client/src/accounts']: { probeAccountAccess: async() => ({ state: 'unpaired' }) },
      './client': { ServiceClient: FakeClient },
      './workspace': { ServiceWorkspace: FakeWorkspace, DEFAULT_ENDPOINT: 'http://fixture' },
      '@react-native-async-storage/async-storage': { setItem: async() => {} },
    }, { localStorage: { getItem: () => 'http://fixture', setItem() {} } })
    session.serviceStatus.configured = true
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

test('Android cache identity follows shared account revisions and endpoints without reading local credentials', async() => {
  let revision = 0, endpoint = 'https://fixture'
  const identity = load(path.join(clients[1].folder, 'dailyIdentity.ts'), {
    './session': { getAccountIdentityRevision: () => String(revision), getWorkspace: () => ({ client: { endpoint } }) },
  })
  const first = await identity.getDailyAccountKey('tx')
  revision++; assert.notEqual(await identity.getDailyAccountKey('tx'), first)
  const second = await identity.getDailyAccountKey('tx'); endpoint = 'https://other'; assert.notEqual(await identity.getDailyAccountKey('tx'), second)
  assert.equal(await identity.getDailyAccountKey('server'), '')
})

test('Android homepage keeps snapshots across appearance, foreground, provider switching and remount; changed account reloads', async() => {
  const client = clients[1]
  const workspace = new client.workspace.ServiceWorkspace(new client.api.ServiceClient('http://fixture'))
  let slots = [], cursor = 0, effects = [], dirty = false, appear, foreground, owner = 'owner-one', selected = 'tx'
  const calls = [], stored = new Map()
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => value === b[i])
  const react = {
    useRef: value => { const i = cursor++; slots[i] ??= { current: value }; return slots[i] },
    useState: initial => { const i = cursor++; slots[i] ??= { value: initial }; return [slots[i].value, value => { slots[i].value = typeof value === 'function' ? value(slots[i].value) : value; dirty = true }] },
    useCallback: (fn, deps) => { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { deps, fn }; return slots[i].fn },
    useEffect: (fn, deps) => { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) { slots[i]?.cleanup?.(); slots[i] = { deps }; effects.push(() => { slots[i].cleanup = fn() }) } },
  }
  const jsx = (type, props, key) => ({ type, props, key })
  const dependencies = {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { View: 'View', AppState: { addEventListener: (_name, fn) => { foreground = fn; return { remove() {} } } } },
    '@react-native-async-storage/async-storage': { getItem: async key => stored.get(key), setItem: async(key, value) => { stored.set(key, value) } },
    '@/core/musicAccount/daily': { getDailyProvider: async() => selected, setDailyProvider: async source => { selected = source } },
    '@/navigation': { useNavigationComponentDidAppear: (_id, fn) => { appear = fn } },
    '@/navigation/navigation': {}, '@/store/common/state': { navActiveId: 'nav_search', componentIds: { home: 'home' } },
    '@/core/player/player': {}, '@/core/player/selection': {},
    '@/store/player/hook': { useIsPlay: () => false, usePlayMusicInfo: () => ({ musicInfo: null }) },
    '@/lang': { useI18n: () => key => key }, '@/store/theme/hook': { useTheme: () => ({}) },
    '@/theme/ui': { Q_UI: { touchSize: 44 } }, '@/utils/tools': { createStyle: value => value, toast() {} },
    '@/utils/hooks/useAdaptiveLayout': () => ({ wide: false }),
    './session': { getWorkspace: () => workspace, serviceStatus: {}, subscribeService: () => () => {}, subscribeRecommendations: () => () => {}, subscribeAccounts: () => () => {} },
    './accounts': {}, './dailyIdentity': { getDailyAccountKey: async() => owner },
    './recommendations': { ...client.recommendations, loadDailyFeed: async(_workspace, source, _personal, force) => { calls.push({ source, force }); return { list: [{ ...song, source }], origin: 'public', kind: source + '_public', status: 'ready', reason: '' } } },
  }
  const context = { exports: {}, AbortController, setTimeout, clearTimeout, require: id => dependencies[id] ?? { default: 'UI', Icon: 'Icon' } }
  const source = readSource(path.join(client.folder, 'DailyRecommendations.tsx'))
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, context)
  let tree
  const render = () => { cursor = 0; dirty = false; tree = context.exports.default(); const pending = effects; effects = []; pending.forEach(fn => fn()) }
  const flush = async() => { for (let i = 0; i < 8; i++) { await new Promise(resolve => setImmediate(resolve)); if (dirty) render() } }
  const find = predicate => {
    const walk = value => {
      if (!value || typeof value !== 'object') return
      if (Array.isArray(value)) { for (const item of value) { const found = walk(item); if (found) return found } }
      if (predicate(value)) return value
      return walk(value.props?.children)
    }
    const value = walk(tree); assert.ok(value, 'Expected homepage control'); return value
  }
  render(); await flush(); assert.equal(calls.length, 1)
  appear(); foreground('active'); await flush(); assert.equal(calls.length, 1)
  find(node => node.key === 'wy' && node.props?.accessibilityRole === 'tab').props.onPress(); await flush()
  assert.equal(calls.length, 2)
  find(node => node.key === 'tx' && node.props?.accessibilityRole === 'tab').props.onPress(); await flush()
  assert.equal(calls.length, 2, 'Returning to a loaded provider reuses its snapshot')
  find(node => node.props?.accessibilityLabel === 'daily_refresh').props.onPress(); await flush()
  assert.equal(calls.length, 3); assert.equal(calls[2].force, true)
  owner = 'owner-two'; appear(); await flush(); assert.equal(calls.length, 4)
  slots.forEach(slot => slot?.cleanup?.()); slots = []; effects = []
  render(); await flush(); assert.equal(calls.length, 4, 'A new view instance reuses the same account snapshot')
  slots.forEach(slot => slot?.cleanup?.())
})

test('desktop recommendations consume normalized shared tracks and preserve server account-change guards', async() => {
  const client = clients[0]
  const workspace = new client.workspace.ServiceWorkspace(new client.api.ServiceClient('http://fixture'))
  let valid = true
  const accounts = load(path.join(client.folder, 'accounts.ts'), {
    '../../../../../packages/service-client/src/accounts': { sharedAccounts: () => ({ daily: async() => { if (!valid) throw new client.api.ServiceError('ACCOUNT_CHANGED'); return { status: 'personalized', kind: 'radar', list: [{ ...song, id: 'one' }, { ...song, id: 'two' }] } } }) },
    './session': { getWorkspace: () => workspace }, './client': client.api,
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
  const script = compiler.compileScript(compiler.parse(readSource(filename)).descriptor, { id: 'home-state-test' }).content
  let calls = 0, visibility
  let next = async() => ({ list: [song], origin: 'account', kind: 'radar', status: 'ready', reason: '' })
  const vue = {
    defineComponent: value => value,
    ref: value => ({ value }), shallowRef: value => ({ value }),
    computed: getter => ({ get value() { return getter() } }),
    watch: (_getter, callback) => { visibility = callback; callback(true) }, onBeforeUnmount: () => {},
  }
  const dependencies = {
    vue, '@common/utils/vueRouter': { useRouter: () => ({ push: async() => {} }) },
    '@renderer/utils/ipc': { getMusicAccountStatus: async() => undefined },
    '@renderer/components/common/SourceIcon.vue': {},
    '@renderer/core/music': { getPicPath: async() => '' }, '@renderer/core/player/selection': {},
    '@renderer/core/player/action': {}, '@renderer/store/player/state': { playMusicInfo: {} },
    './session': { getWorkspace: () => workspace, serviceStatus: {}, subscribeService: () => () => {}, subscribeRecommendations: () => () => {} },
    './accounts': { accountNames: { tx: 'QQ', wy: 'WY', kg: 'KG' } },
    './recommendations': { ...client.recommendations, loadDailyFeed: async(...args) => { calls++; return next(...args) } }, './client': client.api,
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
  visibility(false); visibility(true); await flush()
  assert.equal(calls, 1, 'Returning to the homepage reuses the snapshot without loading again')
  next = async() => { throw Error('offline') }
  await home.loadDailyRecommend(true); assert.equal(home.dailyRecommendList.value.length, 1)
  next = async() => { throw new client.api.ServiceError('ACCOUNT_CHANGED') }
  await home.loadDailyRecommend(false, true); assert.equal(home.dailyRecommendList.value.length, 0)
  let finishOld
  next = async(_workspace, source) => source === 'tx' ? new Promise(resolve => { finishOld = resolve }) : { list: [{ ...song, id: 'wy_new' }], origin: 'account', status: 'ready' }
  const old = home.loadDailyRecommend(false, true)
  home.selectDailyProvider('wy'); await flush()
  finishOld({ list: [{ ...song, id: 'tx_stale' }], origin: 'account', status: 'ready' }); await old
  assert.equal(home.dailyRecommendList.value[0].id, 'wy_new')
})
