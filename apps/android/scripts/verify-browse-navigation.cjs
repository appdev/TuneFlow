const readSource = require('../../../scripts/read-source.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

function load(file, dependencies = {}) {
  const context = { exports: {}, setTimeout, clearTimeout, console, requestAnimationFrame: callback => callback(), require: id => {
    if (!(id in dependencies)) throw Error(id)
    return dependencies[id]
  } }
  vm.runInNewContext(ts.transpileModule(readSource(path.join(__dirname, '..', file)), {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, context)
  return context.exports
}
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const timeout = load('src/core/browseRequest.ts')
const song = name => ({ list: [{ id: name }], limit: 30, total: 1, source: 'kw' })

test('安卓歌单旧响应不会覆盖强制刷新缓存', async () => {
  const calls = []
  const core = load('src/core/songlist.ts', {
    '@/store/songlist/state': {}, '@/store/songlist/action': {}, '@/utils': {}, './browseRequest': timeout,
    '@/utils/musicSdk': { kw: { songList: { getList: () => { const gate = deferred(); calls.push(gate); return gate.promise } } } },
  })
  const old = core.getList('kw', '', 'hot', 1)
  const fresh = core.getList('kw', '', 'hot', 1, true)
  calls[1].resolve(song('fresh')); await fresh
  calls[0].resolve(song('old')); await old
  assert.equal((await core.getList('kw', '', 'hot', 1)).list[0].id, 'fresh')
})

for (const kind of ['songlist', 'leaderboard', 'detail']) {
  test(`安卓 ${kind} 刷新失败后仍能重试原列表，离开页面后不回写`, async () => {
    let handle, cleanup, rendered, writes = 0
    const calls = []
    const state = { listInfo: { source: 'kw', tagId: 'rock', sortId: 'hot', list: [{ id: 'original' }], page: 1 }, listDetailInfo: { source: 'wy', id: 'wy__123', list: [{ id: 'original' }], page: 1 } }
    const request = (...args) => { const gate = deferred(); calls.push({ ...gate, args }); return gate.promise }
    const core = { getList: request, getListDetail: request, clearList: () => { throw Error('must preserve target') }, clearListDetail: () => { throw Error('must preserve target') }, setList: data => { writes++; return data }, setListDetail: data => { writes++; return data } }
    const list = { setStatus() {}, setList() {} }
    const dependencies = {
      react: { forwardRef: fn => fn, useRef: value => ({ current: value === null ? list : value }), useEffect: fn => { cleanup = fn() }, useImperativeHandle: (_, fn) => { handle = fn() }, useMemo: fn => fn() },
      'react/jsx-runtime': { jsx: (component, props) => { rendered = props; return props } },
      './components/Songlist': {}, '@/components/OnlineList': {}, './Header': {}, './state': { useListInfo: () => ({ source: 'wy', id: 'wy__123' }) },
      '@/store/songlist/state': state, '@/store/leaderboard/state': state,
      '@/core/songlist': core, '@/core/leaderboard': core, './listAction': {},
    }
    const file = kind == 'songlist' ? 'Home/Views/SongList/List' : kind == 'leaderboard' ? 'Home/Views/Leaderboard/MusicList' : 'SonglistDetail/MusicList'
    load(`src/screens/${file}.tsx`, dependencies).default({}, {})
    assert.ok(handle)
    rendered.onRefresh()
    calls[0].reject(Error('offline'))
    await new Promise(resolve => setImmediate(resolve))
    rendered.onRefresh()
    assert.deepEqual(calls[1].args, calls[0].args)
    calls[1].resolve(song('recovered'))
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(writes, 1)
    rendered.onRefresh()
    cleanup()
    calls[2].resolve(song('late'))
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(writes, 1)
  })
}

const wechat = load('src/core/musicAccount/wechatAuthorization.ts')
test('微信跳转仅接受官方登录页提供的授权地址', () => {
  const official = 'https://open.weixin.qq.com/connect/qrconnect?appid=test'
  assert.ok(wechat.isWechatLoginPage(official))
  assert.equal(wechat.isWechatLoginPage('https://open.weixin.qq.com.evil.example/connect/qrconnect'), false)
  assert.equal(wechat.getWechatAppUrl('weixin://dl/business/?t=test', official), 'weixin://dl/business/?t=test')
  assert.equal(wechat.getWechatAppUrl('weixin://dl/business/?t=test', 'https://example.com'), null)
  assert.equal(wechat.getWechatAppUrl('weixin://dl/login/test', official), null)
})
test('二维码导出只读取官方会话图片，携带请求序号，不改变网页位置', () => {
  const messages = []
  const location = { protocol: 'https:', hostname: 'open.weixin.qq.com', pathname: '/connect/qrconnect' }
  const image = { src: 'https://open.weixin.qq.com/connect/qrcode/test', complete: true, naturalWidth: 280 }
  const context = { location, window: { ReactNativeWebView: { postMessage: message => messages.push(JSON.parse(message)) } }, document: {
    querySelectorAll: () => [image],
    createElement: () => ({ getContext: () => ({ fillRect() {}, drawImage() {} }), toDataURL: () => 'data:image/png;base64,AAAA' }),
  } }
  vm.runInNewContext(wechat.getWechatQrScript(7), context)
  assert.deepEqual(messages[0], { type: 'wechat-qr-image', image: 'data:image/png;base64,AAAA', requestId: 7 })
  image.complete = false
  vm.runInNewContext(wechat.getWechatQrScript(8), context)
  assert.equal(messages[1].type, 'wechat-qr-unavailable')
  location.hostname = 'example.com'
  vm.runInNewContext(wechat.getWechatQrScript(9), context)
  assert.equal(messages.length, 2)
})
