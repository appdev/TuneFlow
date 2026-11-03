const readSource = require('../../../scripts/read-source.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { EventEmitter } = require('node:events')
const ts = require('typescript')

function windowHarness(platform, transparent = false) {
  const messages = []
  const appEvents = []
  const windows = []
  class Window extends EventEmitter {
    constructor(options) {
      super()
      this.options = options
      this.visible = true
      this.fullscreen = !!options.fullscreen
      windows.push(this)
    }
    loadURL() { return Promise.resolve() }
    isFullScreen() { return this.fullscreen }
    hide() { this.visible = false }
    setProgressBar() {}
    close() {
      let prevented = false
      this.emit('close', { preventDefault() { prevented = true } })
      if (!prevented) this.emit('closed')
    }
  }
  const runtime = {
    lx: {
      appSetting: { 'common.windowSizeId': 0, 'tray.enable': true },
      theme: { shouldUseDarkColors: false, theme: { colors: {} } },
      event_app: new Proxy({}, { get: (_, name) => (...args) => appEvents.push([name, ...args]) }),
    },
    envParams: { cmdParams: { dt: !transparent, hidden: true } },
  }
  const dependencies = {
    electron: { BrowserWindow: Window, session: { fromPartition: () => ({ setProxy: () => Promise.resolve() }) } },
    'node:path': path,
    './utils': { getWindowSizeInfo: () => ({ width: 1114, height: 718 }) },
    '@common/utils': { isMac: platform === 'darwin', isWin: platform === 'win32', isLinux: platform === 'linux', getPlatform: () => platform },
    '@main/utils': { getProxy: () => null },
    '@common/mainIpc': { mainSend: (_win, name, params) => messages.push([name, params]) },
    './rendererEvent': {},
    '@common/utils/electron': { encodePath: value => value },
    '@common/ipcNames': { WIN_MAIN_RENDERER_EVENT_NAME: { fullscreen_changed: 'winMain_fullscreen_changed' } },
  }
  const context = { exports: {}, global: runtime, process: { env: { NODE_ENV: 'production' } }, __dirname: '/qa/dist', setTimeout, require: name => {
    if (!(name in dependencies)) throw Error('Unexpected dependency: ' + name)
    return dependencies[name]
  } }
  const source = readSource(path.join(__dirname, '../src/main/modules/winMain/main.ts'))
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, context)
  context.exports.createWindow()
  return { api: context.exports, window: windows[0], runtime, messages, appEvents }
}

for (const transparent of [false, true]) test(`Mac keeps native controls and rounded corners, transparent=${transparent}`, () => {
  const { window } = windowHarness('darwin', transparent)
  assert.equal(window.options.frame, true)
  assert.equal(window.options.titleBarStyle, 'hiddenInset')
  assert.equal(window.options.roundedCorners, true)
  assert.equal(window.options.transparent, transparent)
  assert.equal(window.options.trafficLightPosition, undefined, 'AppKit owns position and spacing')
})

for (const platform of ['win32', 'linux']) test(`${platform} retains its frameless window`, () => {
  const { window } = windowHarness(platform)
  assert.equal(window.options.frame, false)
  assert.equal(window.options.titleBarStyle, undefined)
})

test('native fullscreen enter/leave updates renderer state and desktop lyric consumers', () => {
  const { window, messages, appEvents } = windowHarness('darwin')
  for (const fullscreen of [true, false]) {
    window.fullscreen = fullscreen
    window.emit(fullscreen ? 'enter-full-screen' : 'leave-full-screen')
    assert.deepEqual(messages.at(-1), ['winMain_fullscreen_changed', fullscreen])
    assert.deepEqual(appEvents.at(-1), ['main_window_fullscreen', fullscreen])
  }
})

test('renderer initialization can resync the actual fullscreen state', () => {
  const { window, api, messages } = windowHarness('darwin')
  window.fullscreen = true
  api.sendFullScreenState()
  assert.deepEqual(messages.at(-1), ['winMain_fullscreen_changed', true])
})

test('native close still hides to tray when enabled', () => {
  const { window, api, appEvents } = windowHarness('darwin')
  window.close()
  assert.equal(window.visible, false)
  assert.equal(api.isExistWindow(), true)
  assert.equal(appEvents.some(([event]) => event === 'main_window_close'), false)
})

test('native close destroys the window when tray is disabled', () => {
  const { window, api, runtime, appEvents } = windowHarness('darwin')
  runtime.lx.appSetting['tray.enable'] = false
  window.close()
  assert.equal(api.isExistWindow(), false)
  assert.equal(appEvents.some(([event]) => event === 'main_window_close'), true)
})

function settingHarness(platform, current = {}) {
  const defaults = { version: 'test', 'tray.enable': false, 'player.isShowStatusBarLyric': false }
  const saved = []
  const runtime = { lx: { appSetting: { ...defaults, ...current } }, envParams: { cmdParams: {} } }
  const dependencies = {
    '@common/utils': { isMac: platform === 'darwin', throttle: fn => fn },
    '@common/utils/migrateSetting': value => value,
    '@common/theme/appearance': {},
    '@main/utils/store': () => ({ override: value => saved.push(value) }),
    '@common/constants': { STORE_NAMES: { APP_SETTINGS: 'config_v2' } },
    '@common/defaultSetting': defaults,
    '@common/defaultHotKey': {},
    './migrate': {},
    electron: {},
    '@common/utils/nodejs': {},
    '@common/theme/index.json': [],
    '@common/theme/material': {},
  }
  const context = { exports: {}, global: runtime, process, require: name => {
    if (!(name in dependencies)) throw Error('Unexpected dependency: ' + name)
    return dependencies[name]
  } }
  vm.runInNewContext(ts.transpileModule(readSource(path.join(__dirname, '../src/main/utils/index.ts')), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, context)
  return { update: context.exports.updateSetting, saved, runtime }
}

test('macOS status-bar lyrics enable and persist background playback in the same update', () => {
  const { update, saved } = settingHarness('darwin')
  const input = { 'player.isShowStatusBarLyric': true }
  const result = update(input)
  assert.equal(result.setting['tray.enable'], true)
  assert.equal(result.updatedSetting['tray.enable'], true)
  assert.equal(result.updatedSetting['player.isShowStatusBarLyric'], true)
  assert.equal(saved[0].setting['tray.enable'], true)
  assert.deepEqual(input, { 'player.isShowStatusBarLyric': true })
})

test('macOS startup repairs saved status-bar lyrics without background playback', () => {
  const { update, saved } = settingHarness('darwin')
  const result = update({ 'player.isShowStatusBarLyric': true, 'tray.enable': false }, true)
  assert.equal(result.setting['tray.enable'], true)
  assert.equal(saved[0].setting['tray.enable'], true)
})

test('macOS keeps background playback while status-bar lyrics are enabled', () => {
  const { update } = settingHarness('darwin', { 'player.isShowStatusBarLyric': true, 'tray.enable': true })
  assert.equal(update({ 'tray.enable': false }).setting['tray.enable'], true)
  assert.equal(update({ 'player.isShowStatusBarLyric': false }).setting['tray.enable'], true)
  assert.equal(update({ 'player.isShowStatusBarLyric': false, 'tray.enable': false }).setting['tray.enable'], false)
})

for (const platform of ['win32', 'linux']) test(`${platform} does not apply macOS status-bar background policy`, () => {
  const { update } = settingHarness(platform)
  assert.equal(update({ 'player.isShowStatusBarLyric': true }).setting['tray.enable'], false)
})
