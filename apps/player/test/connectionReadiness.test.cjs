const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const vue = require('vue')
const sfc = require('@vue/compiler-sfc')
const root = path.resolve(__dirname, '../../..')
const sharedFile = 'packages/service-client/src/connection.ts'
function load(file, dependencies = {}, globals = {}) {
  const context = { exports: {}, Event, ...globals, require: id => {
    if (!(id in dependencies)) throw Error('Unexpected dependency: ' + id)
    return dependencies[id]
  } }
  const code = file.includes('\n') ? file : fs.readFileSync(path.join(root, file), 'utf8')
  vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context)
  return context.exports
}
const policy = load(sharedFile)
const profileKey = 'qmusic.docker.endpoint.v1'
const tokenKey = 'tuneflow.device.v1.' + encodeURIComponent('http://fixture')
function fixture(platform, saved, previouslyConnected = false) {
  const android = platform === 'android'
  const storage = new Map(saved ? [[profileKey, saved]] : [])
  storage.set(tokenKey, 'synthetic-retained-token')
  if (previouslyConnected) storage.set(policy.connectionKey('http://fixture'), '1')
  const requests = [], timers = [], events = new Map(), snapshots = []
  const state = { online: true, syncFailure: false, block: undefined }
  class Client {
    constructor(endpoint) { this.endpoint = endpoint.trim().replace(/\/$/, '') }
    async connect() { requests.push(['connect', this.endpoint]); if (state.block) await state.block; if (!state.online) throw new Error('synthetic offline') }
    async request(url) { requests.push(['request', url]); if (state.syncFailure) throw new Error('synthetic sync unavailable'); return { sequence: 1, events: [] } }
    async settings() { return {} }
  }
  class Workspace {
    constructor(client) { this.client = client }
    async playlists() { return [] }
    async tracks() { return [{ id: 'synthetic-track' }] }
  }
  const prefix = android ? '../../../../' : '../../../../../'
  const session = load(`apps/${android ? 'android/src/service' : 'player/src/renderer/service'}/session.ts`, {
    './client': { ServiceClient: Client, ServiceError: class extends Error { constructor(code) { super(code); this.code = code } } },
    './workspace': { ServiceWorkspace: Workspace, DEFAULT_ENDPOINT: 'http://fixture', PROFILE_KEY: profileKey },
    [prefix + 'packages/service-client/src/connection']: policy,
    [prefix + 'packages/service-client/src/accounts']: { probeAccountAccess: async() => ({ state: 'locked' }) },
    'react-native': { AppState: { addEventListener: (event, fn) => events.set(event, fn) } },
    '@react-native-async-storage/async-storage': { default: { getItem: async key => storage.get(key) ?? null, setItem: async(key, value) => { storage.set(key, value) } } },
  }, {
    process: { platform }, location: { origin: 'http://fixture' },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    window: { addEventListener: (event, fn) => events.set(event, fn), dispatchEvent() {} },
    setTimeout: (fn, delay) => { timers.push({ fn, delay }); return timers.length },
  })
  if (android) session.onServiceLists(data => snapshots.push(data))
  else session.onServiceList('player_list_data_overwire', data => snapshots.push(data.params))
  return { session, storage, requests, state, timers, events, snapshots, init: () => android ? session.loadServiceProfile() : Promise.resolve() }
}

test('shared settings policy gates account/source/download settings only', () => {
  for (const section of ['accounts', 'sources', 'downloads']) assert.equal(policy.requiresService(section), true)
  for (const section of ['connection', 'basic', 'player', 'language', 'about']) assert.equal(policy.requiresService(section), false)
  assert.notEqual(policy.connectionKey('http://one'), policy.connectionKey('http://two'))
})

for (const platform of ['darwin', 'web', 'android']) {
  test(`${platform}: first connection, independent account unlock, and authorization preservation`, async() => {
    const f = fixture(platform)
    await f.init()
    assert.equal(f.session.serviceStatus.hasConnected, false)
    if (platform !== 'web') {
      f.session.startServiceSession()
      assert.equal(f.requests.length, 0, 'new native profile does not silently connect to the default host')
      await f.session.connectService('http://fixture', () => assert.fail('same endpoint must not reset the view'))
    } else await f.session.checkService()
    assert.equal(f.session.serviceStatus.connected, true)
    assert.equal(f.session.serviceStatus.hasConnected, true)
    assert.equal(f.storage.get(tokenKey), 'synthetic-retained-token')
    assert.equal(f.storage.get(policy.connectionKey('http://fixture')), '1')
    assert.equal(f.snapshots.length, 1, 'locked platform accounts do not block shared music data')
  })
  test(`${platform}: outage retains setup/data and automatic reconnect restores readiness`, async() => {
    const f = fixture(platform, 'http://fixture')
    await f.init(); await f.session.checkService()
    const count = f.snapshots.length
    f.state.online = false
    await f.session.checkService()
    assert.equal(f.session.serviceStatus.connected, false)
    assert.equal(f.session.serviceStatus.hasConnected, true)
    assert.equal(f.snapshots.length, count, 'outage must not publish empty playlists')
    f.state.online = true
    f.session.startServiceSession()
    await f.session.checkService()
    assert.equal(f.session.serviceStatus.connected, true)
    assert.equal(f.snapshots.length, count + 1)
    assert.equal(f.storage.get(tokenKey), 'synthetic-retained-token')
    assert.ok(f.events.has(platform === 'android' ? 'change' : 'online'))
  })
  test(`${platform}: concurrent checks share one request; data errors do not become account/connection failures`, async() => {
    const f = fixture(platform, 'http://fixture'); await f.init()
    let release; f.state.block = new Promise(resolve => { release = resolve })
    const a = f.session.checkService(), b = f.session.checkService()
    assert.equal(a, b); release(); await a
    assert.equal(f.requests.filter(([kind]) => kind === 'connect').length, 1)
    f.state.syncFailure = true; await f.session.checkService()
    assert.equal(f.session.serviceStatus.connected, true)
    assert.equal(f.session.serviceStatus.hasConnected, true)
    assert.equal(f.storage.get(tokenKey), 'synthetic-retained-token')
  })
}

test('Web stays on the page origin and remembers successful readiness across reload', async() => {
  const f = fixture('web', 'http://other'); await f.session.checkService()
  assert.equal(f.session.getWorkspace().client.endpoint, 'http://fixture')
  await assert.rejects(f.session.connectService('http://other', () => {}), { code: 'SERVER_CONNECTION_LOCKED' })
  assert.equal(f.storage.get(profileKey), 'http://other')
  const reloaded = fixture('web', undefined, true)
  assert.equal(reloaded.session.serviceStatus.hasConnected, true)
  reloaded.state.online = false; await reloaded.session.checkService()
  assert.equal(reloaded.session.serviceStatus.hasConnected, true, 'a reload while offline is not first-time setup')
})

for (const platform of ['darwin', 'android']) test(`${platform}: failed address validation leaves the saved address, lists and account token unchanged`, async() => {
  const f = fixture(platform, 'http://fixture'); await f.init(); await f.session.checkService()
  const count = f.snapshots.length
  f.state.online = false
  await assert.rejects(f.session.connectService('http://offline', () => assert.fail('must not stop playback or reload')))
  assert.equal(f.storage.get(profileKey), 'http://fixture')
  assert.equal(f.storage.get(tokenKey), 'synthetic-retained-token')
  assert.equal(f.snapshots.length, count)
})

test('Vue remote settings delay first mount, retain mounted drafts while offline, and unblock on reconnect', async() => {
  const status = vue.ref(policy.createConnectionState('http://fixture', false))
  const file = path.join(root, 'apps/player/src/renderer/service/ServiceRequired.vue')
  const script = sfc.compileScript(sfc.parse(fs.readFileSync(file, 'utf8')).descriptor, { id: 'connection-test' }).content
  const component = load(script, { vue, './ConnectionSetup.vue': {}, './useSession': { useServiceStatus: () => status } }).default
  const scope = vue.effectScope()
  try {
    const api = scope.run(() => component.setup({ required: true }, { expose() {} }))
    assert.equal(api.loaded.value, false)
    status.value.connected = true; await vue.nextTick()
    assert.equal(api.loaded.value, true)
    status.value.connected = false; await vue.nextTick()
    assert.equal(api.loaded.value, true, 'do not unmount the settings form on outage')
    assert.equal(api.blocked.value, true)
    status.value.connected = true; await vue.nextTick()
    assert.equal(api.blocked.value, false)
  } finally { scope.stop() }
})

test('settings drafts survive connection updates and failed/offline saves; a completed save preserves newer edits', async() => {
  const status = policy.createConnectionState('http://fixture', true)
  status.connected = true
  let finish, calls = 0
  const client = { endpoint: status.endpoint, settings: async() => ({ 'download.fileName': 'original' }), patchSettings: async() => { calls++; return new Promise(resolve => { finish = resolve }) } }
  const file = path.join(root, 'apps/player/src/renderer/service/ServerSettings.vue')
  const script = sfc.compileScript(sfc.parse(fs.readFileSync(file, 'utf8')).descriptor, { id: 'draft-test' }).content
  const component = load(script, {
    vue: { ...vue, onMounted() {}, onBeforeUnmount: vue.onScopeDispose },
    './SourceManager.vue': {}, './sourceChain': {},
    './workspace': { downloadSettingLabels: { 'download.fileName': 'filename' } },
    './session': { getWorkspace: () => ({ client }), serviceStatus: status, subscribeService: () => () => {} },
    '@renderer/plugins/Dialog': { dialog: {} },
    '@common/rendererIpc': {}, '@common/ipcNames': {},
  }).default
  const scope = vue.effectScope()
  try {
    const api = scope.run(() => component.setup({ section: 'downloads' }, { expose() {} }))
    await api.load()
    api.drafts.value['download.fileName'] = 'draft'
    status.connected = false; api.status.value = { ...status }; await vue.nextTick()
    api.patch('download.fileName', 'draft')
    assert.equal(calls, 0)
    status.connected = true; api.status.value = { ...status }; await vue.nextTick()
    assert.equal(api.drafts.value['download.fileName'], 'draft')
    api.patch('download.fileName', 'draft')
    api.drafts.value['download.fileName'] = 'newer draft'
    finish({ 'download.fileName': 'draft' })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(api.drafts.value['download.fileName'], 'newer draft')
  } finally { scope.stop() }
})
