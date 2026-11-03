const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const path = require('node:path')
const { EventEmitter } = require('node:events')
const ts = require('typescript')
const readSource = require('../../../scripts/read-source.cjs')

function harness(platform = 'darwin') {
  const trays = [], actions = [], symbols = []
  class Image {
    constructor(name) { this.name = path.basename(name); this.representations = []; this.size = name === 'pause.fill' ? { width: 18, height: 26 } : { width: 26, height: 24 } }
    getSize() { return this.size }
    resize(size) { return Object.assign(new Image(this.name), { size }) }
    addRepresentation(value) { this.representations.push(value) }
    toDataURL() { return 'data:image/png;base64,fixture' }
    toBitmap() { return Buffer.alloc(this.size.width * this.size.height * 4, 255) }
    setTemplateImage(value) { this.template = value }
  }
  class Tray extends EventEmitter {
    constructor(image) { super(); this.image = image; this.dead = false; trays.push(this) }
    isDestroyed() { return this.dead }
    destroy() { this.dead = true }
    setIgnoreDoubleClickEvents(value) { this.ignoreDoubleClick = value }
    setImage(image) { this.image = image }
    setToolTip(value) { this.tooltip = value }
    setTitle(value) { this.title = value }
    setContextMenu(value) { this.menu = value }
  }
  const events = new EventEmitter()
  const setting = { 'tray.enable': true, 'tray.themeId': 0, 'player.isShowStatusBarLyric': true, 'common.langId': 'zh-cn' }
  const status = { name: 'Fixture track', singer: 'Fixture artist', lyricLineText: 'Fixture lyric' }
  const config = patch => {
    Object.assign(setting, patch)
    events.emit('updated_config', Object.keys(patch), patch)
  }
  events.update_config = config
  const dependencies = {
    electron: { Tray, Menu: { buildFromTemplate: value => value }, nativeImage: {
      createFromPath: name => new Image(name),
      createFromNamedImage: name => { symbols.push(name); return new Image(name) },
      createFromBitmap: (pixels, size) => Object.assign(new Image('canvas'), { pixels, size }),
    } },
    '@common/utils': { isMac: platform === 'darwin', isWin: platform === 'win32' },
    'node:path': path,
    './winMain': { hideWindow() {}, showWindow() {}, isExistWindow: () => true, isShowWindow: () => true, sendTaskbarButtonClick: action => actions.push(action) },
    '@main/app': { quitApp() {} },
    '@common/constants': { TRAY_AUTO_ID: -1 },
  }
  const context = { Buffer, exports: {}, global: { staticPath: '/fixture', lx: { appSetting: setting, player_status: status, event_app: events, theme: { shouldUseDarkColors: false } } }, require: name => {
    if (!(name in dependencies)) throw Error('Unexpected dependency: ' + name)
    return dependencies[name]
  } }
  vm.runInNewContext(ts.transpileModule(readSource(path.join(__dirname, '../src/main/modules/tray.ts')), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, context)
  context.exports.default()
  events.emit('app_inited')
  return { trays, actions, symbols, events, config, status: patch => {
    Object.assign(status, patch)
    events.emit('player_status', patch)
  } }
}

test('macOS exposes three direct playback icons alongside the existing lyric menu', () => {
  const { trays, actions, symbols, status } = harness()
  assert.deepEqual(symbols, ['backward.end.fill', 'play.fill', 'pause.fill', 'forward.end.fill'])
  assert.equal(trays.length, 4)
  const [lyrics, next, toggle, prev] = trays
  assert.ok(lyrics.menu)
  const playImage = toggle.image
  for (const control of [prev, toggle, next]) {
    assert.equal(control.menu, undefined)
    assert.equal(control.image.template, true)
    assert.equal(control.image.size.width, 16)
    assert.equal(control.image.size.height, 16)
    assert.ok(control.image.pixels.some(value => value === 255))
    assert.ok(control.image.pixels.subarray(0, 16 * 4).every(value => value === 0))
    assert.equal(control.image.representations[0].scaleFactor, 2)
    assert.equal(control.ignoreDoubleClick, true)
  }
  prev.emit('click'); next.emit('click'); toggle.emit('click')
  assert.deepEqual(actions, ['prev', 'next', 'play'])
  status({ status: 'playing' })
  assert.notEqual(toggle.image, playImage)
  assert.equal(toggle.image.size.width, 16)
  assert.equal(toggle.tooltip, '暂停')
  toggle.emit('click')
  assert.equal(actions.at(-1), 'pause')
  status({ status: 'paused' })
  assert.equal(toggle.image, playImage)
  assert.equal(toggle.tooltip, '播放')
  assert.equal(trays.length, 4)
})

test('playback controls refresh tooltips on language changes and preserve the original menu', () => {
  const { trays, config } = harness()
  config({ 'common.langId': 'en-us' })
  assert.deepEqual(trays.slice(1).map(tray => tray.tooltip), ['Next Song', 'Play', 'Prev Song'])
  assert.ok(trays[0].menu.some(item => item.label === 'Show Lyrics on Statusbar' || item.label === 'Hide Lyrics on Statusbar'))
})

test('hiding the main window retains controls; disabling or closing removes all native items', () => {
  const { trays, events, config } = harness()
  events.emit('main_window_hide')
  assert.ok(trays.every(tray => !tray.dead))
  config({ 'tray.enable': false, 'player.isShowStatusBarLyric': false })
  assert.ok(trays.every(tray => tray.dead))
  config({ 'tray.enable': true })
  assert.equal(trays.filter(tray => !tray.dead).length, 4)
  events.emit('main_window_close')
  assert.ok(trays.every(tray => tray.dead))
})

test('controls do not send playback commands with an empty player', () => {
  const { trays, actions, status } = harness()
  status({ status: 'stoped', name: '' })
  for (const control of trays.slice(1)) control.emit('click')
  assert.deepEqual(actions, [])
})

for (const platform of ['win32', 'linux']) test(`${platform} retains its single native tray`, () => {
  const { trays } = harness(platform)
  assert.equal(trays.length, 1)
  assert.ok(trays[0].menu)
})
