const test = require('node:test')
const assert = require('node:assert/strict')
const { load, api, adapter } = require('./verify-service-client.cjs')
const domain = load('src/renderer/service/workspace.ts', { './client': api, './tracks': adapter })

test('main renderer uses the Service transport; offline never falls through to native list storage; lyric window stays native', async() => {
  const registry = load('src/common/rendererTransport.ts')
  const calls = []
  const ipcRenderer = { invoke: async(name, value) => { calls.push([name, value]); return 'native' }, send: (name, value) => { calls.push([name, value]) }, on: () => {}, removeListener: () => {}, removeAllListeners: () => {} }
  const ipc = load('src/common/rendererIpc.ts', { electron: { ipcRenderer }, './rendererTransport': registry })
  assert.equal(await ipc.rendererInvoke('common_get_app_setting'), 'native')
  const remote = []
  const subscriptions = new Set()
  registry.registerRendererTransport({
    handles: name => name.startsWith('player_list_'),
    invoke: async(name, value) => { remote.push([name, value]); throw new api.ServiceError('NETWORK_ERROR') },
    on: (name, listener) => subscriptions.add(listener),
    off: (name, listener) => subscriptions.delete(listener),
    dataKey: key => domain.scopeClientDataKey(key, 'http://one'),
  })
  await assert.rejects(ipc.rendererInvoke('player_list_get'), { code: 'NETWORK_ERROR' })
  assert.equal(calls.length, 1, 'failed Service list read does not read old DB')
  await assert.rejects(ipc.rendererInvoke('player_list_music_add', { id: 'love', musicInfos: [] }), { code: 'NETWORK_ERROR' })
  assert.equal(calls.length, 1, 'failed write does not mutate old DB')
  const listener = () => {}
  ipc.rendererOn('player_list_music_add', listener)
  assert.equal(subscriptions.size, 1)
  ipc.rendererOff('player_list_music_add', listener)
  assert.equal(subscriptions.size, 0)
  ipc.rendererSend('winMain_save_data', { path: 'listUpdateInfo', data: { remote: true } })
  assert.notEqual(calls[1][1].path, 'listUpdateInfo', 'old list metadata is preserved')
  assert.equal(await ipc.rendererInvoke('winLyric_get_config'), 'native')
  assert.equal(remote.length, 2)
})

test('server change requests trusted native reload after validation; rejected addresses preserve the existing profile', async() => {
  const stored = new Map([[domain.PROFILE_KEY, 'http://one']])
  const calls = []
  class Client extends api.ServiceClient { async connect() { if (this.endpoint === 'http://offline') throw new api.ServiceError('NETWORK_ERROR') } }
  const session = load('src/renderer/service/session.ts', { './client': { ...api, ServiceClient: Client }, './workspace': domain }, {
    localStorage: { getItem: key => stored.get(key), setItem: (key, value) => { stored.set(key, value); calls.push('saved') } },
    window: { location: { reload: () => { throw Error('renderer reload is blocked by navigation policy') } } },
  })
  await session.connectService('http://two', () => { calls.push('native-reload') })
  assert.equal(calls.join(','), 'saved,native-reload')
  assert.equal(stored.get(domain.PROFILE_KEY), 'http://two')
  await assert.rejects(session.connectService('http://offline', () => { calls.push('wrong') }), { code: 'NETWORK_ERROR' })
  assert.equal(stored.get(domain.PROFILE_KEY), 'http://two')
})

test('native reload IPC accepts only the main renderer and takes no external navigation target', () => {
  let handler
  let count = 0
  const main = { reload: () => { count++ } }
  const register = load('src/main/modules/winMain/rendererEvent/service.ts', {
    '@common/mainIpc': { mainOn: (name, listener) => { handler = listener } },
    '@common/ipcNames': { WIN_MAIN_RENDERER_EVENT_NAME: { restart_window: 'reload' } },
    '../main': { getWebContents: () => main },
  }).default
  register()
  handler({ event: { sender: {} } }); assert.equal(count, 0)
  handler({ event: { sender: main } }); assert.equal(count, 1)
})

test('hosted Web always uses its origin and rejects server changes before network or storage writes', async() => {
  const stored = new Map([[domain.PROFILE_KEY, 'http://old-server:3124']])
  let probes = 0, writes = 0, reloads = 0
  class Client extends api.ServiceClient { async connect() { probes++ } }
  const session = load('src/renderer/service/session.ts', { './client': { ...api, ServiceClient: Client }, './workspace': domain }, {
    process: { platform: 'web' }, location: { origin: 'http://hosted-server:3125' },
    localStorage: { getItem: key => stored.get(key), setItem: () => { writes++ } },
  })
  assert.equal(session.isServerBoundWeb, true)
  assert.equal(session.getWorkspace().client.endpoint, 'http://hosted-server:3125')
  await assert.rejects(session.connectService('http://other-server:3124', () => { reloads++ }), { code: 'SERVER_CONNECTION_LOCKED' })
  assert.equal(probes, 0)
  assert.equal(writes, 0)
  assert.equal(reloads, 0)
  assert.equal(stored.get(domain.PROFILE_KEY), 'http://old-server:3124', 'unrelated saved profile data is preserved')
})

test('server data round-trips canonical IDs; library paths are public Service routes; scoped device metadata is isolated', async() => {
  const workspace = new domain.ServiceWorkspace(new api.ServiceClient('http://one'))
  const track = workspace.native({ id: 'wy_12', source: 'wy', name: 'Song', meta: { songId: 12 } })
  assert.equal(workspace.remoteId(track.id), 'wy_12')
  assert.equal(JSON.stringify(workspace.original(track)), JSON.stringify(track.meta.service.track))
  const restored = new domain.ServiceWorkspace(new api.ServiceClient('http://one'))
  assert.equal(restored.remoteId(track.id), 'wy_12', 'removal/reorder works after cache restart')
  const library = restored.native({ id: 'a'.repeat(64), source: 'local', meta: {} })
  assert.equal(library.meta.service.streamPath, `/api/v1/library/tracks/${'a'.repeat(64)}/stream`)
  assert.equal(library.meta.service.lyricsPath, `/api/v1/library/tracks/${'a'.repeat(64)}/lyrics`)
  assert.equal(library.meta.filePath, undefined)
  for (const key of ['playInfo', 'listScrollPosition', 'listUpdateInfo', '@play_info', '@list_prev_select_id']) {
    assert.notEqual(domain.scopeClientDataKey(key, 'http://one'), key)
    assert.notEqual(domain.scopeClientDataKey(key, 'http://one'), domain.scopeClientDataKey(key, 'http://two'))
  }
  for (const key of ['theme.id', 'player.mediaDeviceId', 'desktopLyric.enable']) assert.equal(domain.isServerSetting(key), false)
  assert.equal(domain.isServerSetting('download.maxDownloadNum'), true)
})

test('desktop, Web and Android expose playback auto-download as one shared setting without sharing device playback preferences', () => {
  const android = load('../android/src/service/workspace.ts')
  for (const workspace of [domain, android]) {
    assert.equal(workspace.isServerSetting('player.autoDownloadOnPlay'), true)
    assert.equal(workspace.downloadSettingLabels['player.autoDownloadOnPlay'], '边听边存（播放时自动下载）')
    for (const key of ['player.volume', 'player.playQuality', 'player.mediaDeviceId']) assert.equal(workspace.isServerSetting(key), false)
  }
})

test('catalog adapters reject stale responses after server changes instead of repopulating native caches', async() => {
  let complete
  let workspace = { search: async() => new Promise(resolve => { complete = resolve }) }
  const sdk = { sources: [{ id: 'kw' }], kw: { musicSearch: {}, songList: {}, leaderboard: {} } }
  domain.installServiceCatalog(sdk, () => workspace)
  const request = sdk.kw.musicSearch.search('test')
  workspace = { search: async() => ({ list: [] }) }
  complete({ list: [{ id: 'old-server' }] })
  await assert.rejects(request, { code: 'SERVER_CHANGED' })
})

test('album pagination preserves order and rejects repeated/incomplete pages and invalid identifiers', async() => {
  let mode = 'ok'
  const workspace = new domain.ServiceWorkspace({ endpoint: 'http://server', request: async(path, method, body) => {
    const track = id => ({ id, source: 'tx', meta: { songId: id } })
    if (mode === 'repeat') return { tracks: [track('first')], hasMore: true, total: 3 }
    if (mode === 'incomplete') return { tracks: [track('first')], hasMore: false, total: 2 }
    return { tracks: [track(body.page === 1 ? 'first' : 'second')], hasMore: body.page === 1, total: 2 }
  } })
  assert.equal((await workspace.album('tx', 'album1')).map(track => track.meta.service.track.id).join(','), 'first,second')
  mode = 'repeat'; await assert.rejects(workspace.album('tx', 'album1'), { code: 'ALBUM_PAGINATION_REPEATED' })
  mode = 'incomplete'; await assert.rejects(workspace.album('tx', 'album1'), { code: 'ALBUM_INCOMPLETE' })
  await assert.rejects(workspace.album('wy', '../private'), { code: 'INVALID_ALBUM_ID' })
})

test('Android list events dispatch to Service without invoking device persistence or peer synchronization', async() => {
  const unexpected = () => { throw new Error('old device storage was touched') }
  const writes = []
  const empty = new Proxy({}, { get: () => unexpected })
  const { ListEvent } = load('../android/src/event/listEvent.ts', {
    './Event': class { emit() { unexpected() } },
    '@/utils/data': empty,
    '@/utils/listManage': empty,
    '@/config/constant': { LIST_IDS: { DEFAULT: 'default', LOVE: 'love' } },
    '@/core/list': empty,
    '@/store/list/state': { default: {} },
    '@/service/session': { isServiceMode: () => true, serviceListAction: async(action, data) => { writes.push({ action, data }) } },
  })
  const event = new ListEvent()
  await event.list_create(2, [{ id: 'server', name: 'Server' }])
  await event.list_music_add('love', [{ id: 'track' }], 'bottom')
  await event.list_music_remove('love', ['track'])
  await event.list_music_move('love', 'server', [{ id: 'track' }], 'bottom')
  await event.list_music_update_position('server', 0, ['track'])
  await event.list_remove(['server'])
  assert.equal(writes.map(write => write.action).join(','), 'add,music_add,music_remove,music_move,music_update_position,remove')
})
