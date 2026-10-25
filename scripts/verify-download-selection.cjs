const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
function fixture(options = {}) {
  const calls = [], messages = []
  const deps = {
    './worker': { downloadMusics: async (tracks, quality) => { calls.push({ tracks, quality }); if (options.gate) await options.gate; if (options.error) throw Error('failed'); return options.granted !== false } },
    '@/store/setting/state': { setting: { 'player.playQuality': 'flac' } },
    '@/utils/tools': { toast: text => messages.push(text) },
    '@/service/tracks': { isServerLibraryTrack: music => music.meta?.service?.track?.source === 'local' },
  }
  const context = { exports: {}, global: { i18n: { t: text => text } }, require: id => { assert.ok(id in deps, id); return deps[id] } }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/core/download/selection.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText, context)
  return { ...context.exports, calls, messages }
}
test('混合歌单跳过本地文件、去重在线歌曲，并使用当前音质', async () => {
  const h = fixture()
  const one = { id: '1', source: 'wy' }, two = { id: '1', source: 'tx' }
  const library = { id: 'server-local', source: 'kw', meta: { service: { track: { source: 'local' } } } }
  assert.equal(await h.downloadSelection([one, { id: 'local', source: 'local' }, library, one, two]), true)
  assert.equal(h.calls.length, 1)
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0])), { tracks: [one, two], quality: 'flac' })
  assert.deepEqual(h.messages, ['download_selection_added'])
})
test('重复点击复用同一任务，不并发申请权限；取消与失败不报下载成功', async () => {
  let resolve
  const h = fixture({ gate: new Promise(done => { resolve = done }) })
  const tracks = [{ id: '1', source: 'wy' }]
  const one = h.downloadSelection(tracks), two = h.downloadSelection(tracks)
  await new Promise(setImmediate)
  assert.equal(h.calls.length, 1)
  resolve()
  assert.equal(await one, true)
  assert.equal(await two, true)
  assert.equal(h.messages.length, 1)
  const denied = fixture({ granted: false })
  assert.equal(await denied.downloadSelection(tracks), false)
  assert.deepEqual(denied.messages, [])
  const failed = fixture({ error: true })
  assert.equal(await failed.downloadSelection(tracks), false)
  assert.deepEqual(failed.messages, ['download_selection_failed'])
  await failed.downloadSelection(tracks)
  assert.equal(failed.calls.length, 2)
})
test('纯本地列表不启动下载', async () => {
  const h = fixture()
  assert.equal(await h.downloadSelection([{ id: '1', source: 'local' }]), false)
  assert.equal(h.calls.length, 0)
  assert.deepEqual(h.messages, ['download_selection_local'])
})
