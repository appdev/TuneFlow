const readSource = require('../../../scripts/read-source.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const load = (file, dependencies, globals = {}) => {
  const context = { exports: {}, Map, Set, URL, console, ...globals, require: name => { if (!(name in dependencies)) throw Error('Unexpected dependency: ' + name); return dependencies[name] } }
  vm.runInNewContext(ts.transpileModule(readSource(path.resolve(__dirname, '..', file)), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, context)
  return context.exports
}
const runtime = () => {
  const storage = new Map()
  const electron = load('src/web-runtime/electron.ts', {
    '@common/defaultSetting': { 'common.fontSize': 16, 'download.maxDownloadNum': 2 },
    '@common/defaultHotKey': { local: { enable: true, keys: {} } },
    '@common/theme/index.json': [],
    './unavailable': { unavailable: name => { throw Object.assign(Error(name), { code: 'UNSUPPORTED_CAPABILITY' }) } },
    './theme': { applyWebTheme: () => ({ shouldUseDarkColors: false, theme: { id: 'green', colors: {} } }) },
  }, { localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) } })
  return { ...electron, storage }
}
test('Web UI settings stay local; server settings and unknown fields are not persisted', async() => {
  const { ipcRenderer, storage } = runtime()
  await ipcRenderer.invoke('common_set_app_setting', { 'common.fontSize': 18, 'download.maxDownloadNum': 9, privateCookie: 'synthetic-test-value' })
  const value = await ipcRenderer.invoke('common_get_app_setting')
  assert.equal(value['common.fontSize'], 18)
  assert.equal(value['download.maxDownloadNum'], 2)
  assert.equal(value.privateCookie, undefined)
  assert.equal(storage.size, 1)
})
test('Web account status is explicit, safe for homepage rendering, and has no native credentials', async() => {
  const { ipcRenderer } = runtime()
  const status = await ipcRenderer.invoke('winMain_music_account_status')
  for (const id of ['tx', 'wy', 'kg']) { assert.equal(status[id], false); assert.equal(status.accounts[id].hasSession, false) }
  assert.equal((await ipcRenderer.invoke('winMain_music_account_daily')).status, 'login_required')
  await assert.rejects(ipcRenderer.invoke('winMain_music_account_login', 'tx'), { code: 'UNSUPPORTED_CAPABILITY' })
})
test('unsupported native operations reject rather than claim success or access device files', async() => {
  const { ipcRenderer } = runtime()
  for (const name of ['winMain_trash_local_music_file', 'winMain_show_select_dialog', 'winMain_music_account_transfer_start']) await assert.rejects(ipcRenderer.invoke(name), { code: 'UNSUPPORTED_CAPABILITY' })
})
test('browser client data survives reads in its own namespace', async() => {
  const { ipcRenderer, storage } = runtime()
  ipcRenderer.send('winMain_save_data', { path: 'serviceData_test_playInfo', data: { index: 3 } })
  assert.equal((await ipcRenderer.invoke('winMain_get_data', 'serviceData_test_playInfo')).index, 3)
  assert.equal(await ipcRenderer.invoke('winMain_get_data', 'playInfo'), null)
  assert.ok([...storage.keys()].every(key => key.startsWith('qmusic.web.v1.')))
})
test('Web IPC unsubscribes wrapped settings listeners and supports once without leaks', async() => {
  const { ipcRenderer } = runtime()
  const ipc = load('src/web-runtime/rendererIpc.ts', { './electron': { ipcRenderer }, '@common/rendererTransport': { getRendererTransport: () => null } })
  let calls = 0
  const listener = () => { calls++ }
  ipc.rendererOn('winMain_on_config_change', listener)
  ipc.rendererOn('winMain_on_config_change', listener)
  await ipc.rendererInvoke('common_set_app_setting', { 'common.fontSize': 18 })
  assert.equal(calls, 1)
  ipc.rendererOff('winMain_on_config_change', listener)
  await ipc.rendererInvoke('common_set_app_setting', { 'common.fontSize': 17 })
  assert.equal(calls, 1)
  ipc.rendererOnce('winMain_on_config_change', listener)
  await ipc.rendererInvoke('common_set_app_setting', { 'common.fontSize': 16 })
  await ipc.rendererInvoke('common_set_app_setting', { 'common.fontSize': 15 })
  assert.equal(calls, 2)
})
test('failed shared playlist operations never fall back to browser persistence', async() => {
  const { ipcRenderer, storage } = runtime()
  const transport = { handles: name => name.startsWith('player_list_'), invoke: async() => { throw Object.assign(Error('offline'), { code: 'NETWORK_ERROR' }) } }
  const ipc = load('src/web-runtime/rendererIpc.ts', { './electron': { ipcRenderer }, '@common/rendererTransport': { getRendererTransport: () => transport } })
  await assert.rejects(ipc.rendererInvoke('player_list_music_add', { id: 'love', musicInfos: [] }), { code: 'NETWORK_ERROR' })
  assert.equal(storage.size, 0)
})
