const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const { EventEmitter } = require('node:events')
function load(file, dependencies, extra = {}) {
  const context = { exports: {}, console, URL, AbortController, setTimeout, clearTimeout, process: { platform: 'win32', arch: 'x64', env: {}, versions: { app: '0.4.8' } }, ...extra,
    require: id => { if (!(id in dependencies)) throw new Error(id); return dependencies[id] },
  }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText, context)
  return context.exports
}
const sources = load('src/common/utils/updateSources.ts', { './updateMirror.json': { baseUrl: '' } })
test('Docker preview cannot register upstream update/download/install handlers', () => {
  const handlers = []
  const updater = new EventEmitter()
  const init = load('src/main/modules/winMain/autoUpdate.ts', {
    '@common/servicePreview': { SERVICE_PREVIEW: true }, 'electron-updater': { autoUpdater: updater },
    'builder-util-runtime': {}, '@common/utils': { log: {} }, '@common/mainIpc': { mainOn: name => handlers.push(name) },
    './index': {}, '@common/ipcNames': {}, '@common/utils/updateSources': {}, './updateProvider': {},
  }).default
  init()
  assert.equal(handlers.length, 0)
  assert.equal(updater.eventNames().length, 0)
})
test('更新检查跨线路、排除另一平台和预发布，并选择新版本而非先到的 CDN 缓存', async() => {
  let started = 0
  const result = await sources.getUpdateVersion(async url => {
    started++
    if (url.includes('api.github')) return [
      { tag_name: 'v0.5.0', assets: [{ name: 'Q-music-android-v0.5.0-arm64-v8a.apk' }] },
      { tag_name: 'v0.4.11', prerelease: true, assets: [{ name: 'latest.yml' }] },
      { tag_name: 'v0.4.10', assets: [{ name: 'latest.yml' }] },
    ]
    if (url.includes('jsdelivr')) return { version: '0.4.8' }
    if (url.startsWith('https://raw.')) return { version: '0.4.12' }
    throw Error('offline')
  }, 'desktop')
  assert.equal(started, 5)
  assert.equal(result.version, '0.4.10')
  assert.equal((await sources.getUpdateVersion(async url => {
    if (url.startsWith('https://ghfast.top/')) return { version: '0.4.10' }
    throw Error('GitHub blocked')
  }, 'android')).version, '0.4.10')
  await assert.rejects(sources.getUpdateVersion(async() => ({ version: '../bad' }), 'desktop'))
})
test('自有 R2 映射只接受 Q-music 正式发布地址', () => {
  const own = load('src/common/utils/updateSources.ts', { './updateMirror.json': { baseUrl: 'https://updates.example.com/' } })
  const url = own.downloadUrl(own.downloadSources[0], own.assetUrl('0.4.10', 'latest.yml'))
  assert.equal(url, 'https://updates.example.com/releases/v0.4.10/latest.yml')
  assert.throws(() => own.downloadUrl(own.downloadSources[0], 'https://example.net/private'))
  assert.throws(() => own.assetUrl('0.4.10', '../wrong.exe'))
})
test('PC 镜像返回 HTML/错误版本时被排除，切线保留最初的校验值', async() => {
  const metadata = 'version: 0.4.10\nfiles:\n  - url: Q-music-v0.4.10-x64-Setup.exe\n    sha512: trusted-hash\n    size: 123\n'
  const provider = load('src/main/modules/winMain/updateProvider.ts', {
    'node:crypto': require('node:crypto'),
    '@common/utils/request': { request: async url => ({ statusCode: 200, body: url.startsWith('https://ghfast') ? '<html>unavailable</html>' : metadata }) },
    'electron-updater/out/providers/Provider': require('electron-updater/out/providers/Provider'),
    '@common/utils/updateSources': sources,
  })
  const { info, sources: order } = await provider.loadUpdateMetadata('0.4.10')
  assert.notEqual(order[0].prefix, 'https://ghfast.top/')
  let prefix = ''
  const Custom = provider.createUpdateProvider(info, () => prefix)
  const instance = new Custom({}, {}, { platform: 'win32' })
  assert.equal(instance.resolveFiles(info)[0].info.sha512, 'trusted-hash')
  prefix = 'https://gh-proxy.com/'
  assert.equal(instance.resolveFiles(info)[0].url.href, 'https://gh-proxy.com/https://github.com/Nshpiter/Q-music/releases/download/v0.4.10/Q-music-v0.4.10-x64-Setup.exe')
  assert.equal(instance.resolveFiles(info)[0].info.sha512, 'trusted-hash')
  await assert.rejects(provider.loadUpdateMetadata('0.4.11'))
  await assert.rejects(provider.loadUpdateMetadata('0.4.10', [{ name: 'latest.yml', digest: 'sha256:' + '0'.repeat(64) }]))
})
test('PC 首条线路失败后自动切换，不提前报错，重复点击不并发下载', async() => {
  const updater = new EventEmitter()
  const events = []
  const handlers = {}
  let attempts = 0
  let done
  const finished = new Promise(resolve => { done = resolve })
  Object.assign(updater, {
    setFeedURL() {},
    async checkForUpdates() { updater.emit('update-available', { version: '0.4.10' }); return { isUpdateAvailable: true } },
    async downloadUpdate() {
      attempts++
      if (attempts === 1) { updater.emit('error', Error('offline')); throw Error('offline') }
      updater.emit('update-downloaded', { version: '0.4.10' }); done()
    },
  })
  load('src/main/modules/winMain/autoUpdate.ts', {
    '@common/servicePreview': { SERVICE_PREVIEW: false },
    'electron-updater': { autoUpdater: updater },
    'builder-util-runtime': require('builder-util-runtime'),
    '@common/utils': { log: { warn() {} }, isWin: true },
    '@common/mainIpc': { mainOn: (name, handler) => { handlers[name] = handler } },
    './index': { isExistWindow: () => true, sendEvent: (name, info) => events.push({ name, info }) },
    '@common/ipcNames': { WIN_MAIN_RENDERER_EVENT_NAME: new Proxy({}, { get: (_, key) => key }) },
    '@common/utils/updateSources': { ...sources, getUpdateVersion: async() => ({ version: '0.4.10', desc: '' }) },
    './updateProvider': { requestUpdate() {}, createUpdateProvider() {}, loadUpdateMetadata: async() => ({ info: { version: '0.4.10' }, sources: sources.downloadSources }) },
  }, { global: { lx: { appSetting: { 'common.tryAutoUpdate': false } } } }).default()
  handlers.update_download_update()
  handlers.update_download_update()
  await finished
  assert.equal(attempts, 2)
  assert.equal(events.filter(event => event.name === 'update_error').length, 0)
  assert.equal(events.filter(event => event.name === 'update_downloaded').length, 1)
})
