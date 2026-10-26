const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const { EventEmitter } = require('node:events')
function load(file, dependencies) {
  const exports = {}
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/main/modules/winMain', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: id => dependencies[id], URL, Promise, setInterval, clearInterval })
  return exports
}
test('登录窗口落在父窗口所在屏幕工作区，小屏幕与缩放后的网页不裁剪固定弹层', () => {
  let workArea = { x: 1920, y: 0, width: 800, height: 600 }
  const layout = load('accountLoginLayout.ts', { electron: { screen: {
    getPrimaryDisplay: () => ({ workArea }), getDisplayMatching: () => ({ workArea }),
  } } })
  for (const popup of [false, true]) {
    const bounds = layout.getAccountLoginBounds({ getBounds: () => ({}) }, popup)
    assert.ok(bounds.x >= workArea.x && bounds.x + bounds.width <= workArea.x + workArea.width)
    assert.ok(bounds.y >= workArea.y && bounds.y + bounds.height <= workArea.y + workArea.height)
    assert.ok(bounds.minHeight <= bounds.height && bounds.minWidth <= bounds.width)
    assert.equal(bounds.resizable, true)
  }
  for (const url of ['https://music.163.com/#/login', 'https://y.qq.com/n/ryqq/profile']) {
    const zoom = layout.getAccountLoginZoom(url, 550, 380)
    assert.equal(zoom, 0.5)
    assert.ok(550 / zoom >= 1100 && 380 / zoom >= 760)
  }
  assert.equal(layout.getAccountLoginZoom('https://open.weixin.qq.com/connect/qrconnect', 420, 560), 1)
  assert.equal(layout.getAccountLoginZoom('https://graph.qq.com/oauth2.0/authorize', 720, 540), 1)
  assert.equal(layout.getAccountLoginZoom('https://music.163.com/', 1600, 1000), 1)
  workArea = { x: 0, y: 0, width: 1920, height: 1080 }
  assert.equal(layout.getAccountLoginBounds().width, 1100)
})

const tick = async () => new Promise(resolve => setImmediate(resolve))
function harness() {
  const windows = []
  class Window extends EventEmitter {
    constructor(options) { super(); this.options = options; this.webContents = new EventEmitter(); this.urls = []; windows.push(this) }
    static getFocusedWindow() { return {} }
    isDestroyed() { return !!this.destroyed }
    show() { this.visible = true }
    focus() { this.focused = true }
    async loadURL(url) { this.urls.push(url); this.emit('ready-to-show') }
    close() { this.destroyed = true; this.emit('closed') }
  }
  const api = load('officialAccountLogin.ts', {
    electron: { BrowserWindow: Window },
    './accountLoginLayout': { getAccountLoginBounds: () => ({ width: 900, height: 700, resizable: true }), fitAccountLoginWindow() {} },
  })
  const cookies = new EventEmitter()
  let connected = false
  let onChild
  const options = { title: '测试登录', url: 'https://y.qq.com/n/ryqq/profile', session: { cookies }, configureProxy: async () => {},
    verify: async () => connected, configureContents: (_contents, callback) => { onChild = callback },
  }
  return { api, options, windows, cookies, connect: () => { connected = true }, child: window => onChild(window), Window }
}
test('官方 iframe Cookie 完成音乐接口验证后关闭窗口，验证失败不误报成功', async () => {
  const h = harness()
  const pending = h.api.openOfficialAccountLogin('tx', h.options)
  const repeated = h.api.openOfficialAccountLogin('tx', h.options)
  await tick()
  assert.equal(h.windows.length, 1)
  assert.equal(h.windows[0].visible, true)
  assert.equal(h.windows[0].focused, true)
  assert.equal(h.windows[0].options.webPreferences.session, h.options.session)
  assert.equal(h.windows[0].urls.at(-1), h.options.url)
  h.cookies.emit('changed')
  await tick()
  assert.equal(h.windows[0].isDestroyed(), false)
  const child = new h.Window({})
  h.child(child)
  h.connect()
  h.cookies.emit('changed')
  assert.equal(await pending, 'connected')
  assert.equal(await repeated, 'connected')
  assert.equal(child.isDestroyed(), true)
  assert.equal(h.cookies.listenerCount('changed'), 0)
})
test('代理等待时窗口可关闭；迟到的初始化与验证结果不能继续导航或成功登录', async () => {
  const h = harness()
  let releaseProxy, releaseVerify
  h.options.configureProxy = () => new Promise(resolve => { releaseProxy = resolve })
  h.options.verify = () => new Promise(resolve => { releaseVerify = resolve })
  const pending = h.api.openOfficialAccountLogin('tx', h.options)
  await tick()
  assert.equal(h.windows[0].visible, true)
  h.cookies.emit('changed')
  h.windows[0].close()
  releaseProxy()
  releaseVerify(true)
  await tick()
  assert.equal(await pending, 'cancelled')
  assert.equal(h.windows[0].urls.length, 1)
  assert.equal(h.cookies.listenerCount('changed'), 0)
})
test('加载失败显示可重试的页面，保留关闭窗口能力', async () => {
  const h = harness()
  h.options.configureProxy = async () => { throw Error('network') }
  const pending = h.api.openOfficialAccountLogin('wy', h.options)
  await tick()
  assert.match(decodeURIComponent(h.windows[0].urls.at(-1)), /重新加载/)
  h.windows[0].close()
  assert.equal(await pending, 'cancelled')
})

test('官方导航权限仅属于对应窗口，不能绕过主界面或其他平台的全局 guard', () => {
  const policy = load('../../utils/navigationPolicy.ts', { '@common/config': { navigationUrlWhiteList: [] } })
  const main = new EventEmitter(), qq = new EventEmitter(), wy = new EventEmitter(), child = new EventEmitter()
  for (const contents of [main, qq, wy, child]) policy.installNavigationGuard(contents)
  const allowQQ = url => policy.allowOfficialNavigation(url, ['qq.com', 'weixin.com'])
  policy.setWindowNavigationPolicy(qq, allowQQ)
  policy.setWindowNavigationPolicy(child, allowQQ)
  policy.setWindowNavigationPolicy(wy, url => policy.allowOfficialNavigation(url, ['163.com']))
  const blocked = (contents, target) => {
    const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true } }
    contents.emit('will-navigate', event, target)
    return event.defaultPrevented
  }
  const callback = 'https://y.qq.com/portal/wx_redirect.html?login_type=2&code=private-test-code'
  assert.equal(blocked(main, callback), true)
  assert.equal(blocked(wy, callback), true)
  assert.equal(blocked(qq, callback), false)
  assert.equal(blocked(child, callback), false)
  assert.equal(blocked(wy, 'https://music.163.com/#/login'), false)
  for (const target of ['https://y.qq.com.evil.test/', 'https://fakeqq.com/', 'https://qq.com@evil.test/', 'https://name:pass@y.qq.com/', 'https://y.qq.com:444/', 'http://y.qq.com/', 'file://qq.com/test', 'javascript:alert(1)']) {
    assert.equal(blocked(qq, target), true, target)
  }
})
