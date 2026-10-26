const readSource = require('../../../scripts/read-source.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const http = require('node:http')
const ts = require('typescript')
const cache = new Map()
function load(relative, dependencies = {}, globals = {}) {
  const filename = path.join(__dirname, '..', relative)
  const context = { exports: {}, fetch, AbortController, setTimeout, clearTimeout, process: { platform: process.platform }, ...globals, require: id => {
    if (id in dependencies) return dependencies[id]
    if (id.startsWith('.')) {
      const resolved = path.relative(path.join(__dirname, '..'), path.resolve(path.dirname(filename), `${id}.ts`))
      if (!cache.has(resolved)) cache.set(resolved, load(resolved))
      return cache.get(resolved)
    }
    throw new Error(`Unexpected dependency: ${id}`)
  } }
  vm.runInNewContext(ts.transpileModule(readSource(filename), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, context, { filename })
  return context.exports
}
const api = load('src/renderer/service/client.ts')
const adapter = load('src/renderer/service/tracks.ts', { './client': api })
const original = { id: 'tx_1', source: 'tx', name: 'Song', singer: 'Artist', interval: '03:00', meta: { songId: 'mid', albumName: 'Album', strMediaMid: 'media', toggleMusicInfo: { id: 'wrong' } } }

test('browser transport is called without a ServiceClient receiver (Chromium Illegal invocation regression)', async() => {
  const transport = function() { 'use strict'; assert.equal(this, undefined); return Promise.resolve({ ok: true, status: 200, json: async() => ({ data: { ok: true } }) }) }
  assert.equal((await new api.ServiceClient('http://localhost', transport).request('/api/v1/health')).ok, true)
})

test('addresses reject credentials/traversal; opaque media stays on selected Service', () => {
  assert.equal(api.normalizeEndpoint(' http://192.168.0.70:3124/ '), 'http://192.168.0.70:3124')
  assert.equal(api.normalizeEndpoint('https://music.example/service/'), 'https://music.example/service')
  for (const value of ['file:///music', 'http://user:password@host', 'https://host/?secret=x', 'https://host/#x', 'http://host:0', 'http://host:65536', 'https://host/../private', 'https://host/%2e%2e', 'https://host/%2fprivate']) assert.throws(() => api.normalizeEndpoint(value), { code: 'INVALID_SERVER_ADDRESS' })
  const client = new api.ServiceClient('https://host')
  assert.equal(client.resourceUrl('/api/v1/streams/opaque'), 'https://host/api/v1/streams/opaque')
  for (const value of ['https://upstream/song.mp3', '//evil/file', '/api/v1/streams/../settings', '/api/v1/streams/%2e%2e/settings', '/api/v1/settings', '/api/v1/streams/key?redirect=evil']) assert.throws(() => client.resourceUrl(value), { code: 'INVALID_RESOURCE_URL' })
})

test('HTTP envelope, safe errors, 204, no cookie forwarding, cancellation and no mutation retry', async t => {
  const seen = []
  const server = http.createServer((req, res) => {
    seen.push(req)
    if (req.url.endsWith('/slow')) return
    if (req.url.endsWith('/empty')) { res.writeHead(204).end(); return }
    if (req.url.endsWith('/html')) { res.writeHead(401).end('<html>proxy</html>'); return }
    res.setHeader('content-type', 'application/json')
    if (req.url.endsWith('/failure')) { res.writeHead(502).end(JSON.stringify({ error: { code: 'TARGET_BLOCKED', message: 'private upstream URL' } })); return }
    if (req.url.endsWith('/invalid')) { res.end('{}'); return }
    res.end(JSON.stringify({ data: { ok: true } }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections(); server.close() })
  const client = new api.ServiceClient(`http://127.0.0.1:${server.address().port}`)
  assert.equal((await client.request('/api/v1/test', 'POST', { value: 1 })).ok, true)
  assert.equal(seen[0].headers.cookie, undefined)
  await assert.rejects(client.request('/api/v1/failure', 'DELETE'), { code: 'TARGET_BLOCKED', status: 502 })
  assert.equal(seen.filter(item => item.url.endsWith('/failure')).length, 1)
  await assert.rejects(client.request('/api/v1/invalid'), { code: 'INVALID_RESPONSE' })
  await assert.rejects(client.request('/api/v1/html'), { code: 'HTTP_401', status: 401 })
  assert.equal(await client.request('/api/v1/empty', 'DELETE'), undefined)
  const controller = new AbortController()
  const pending = client.request('/api/v1/slow', 'GET', undefined, controller.signal); controller.abort()
  await assert.rejects(pending, { code: 'CANCELLED' })
})

test('DTO retains provider data, unique server/provider IDs, restores provenance without stale URLs', () => {
  const first = adapter.toServiceTrack(original, 'http://one:3124')
  const second = adapter.toServiceTrack({ ...original, source: 'wy' }, 'http://one:3124')
  const third = adapter.toServiceTrack(original, 'http://two:3124')
  assert.equal(new Set([first.id, second.id, third.id]).size, 3)
  assert.equal(first.meta.strMediaMid, 'media'); assert.equal(first.meta.toggleMusicInfo, undefined)
  assert.equal(JSON.stringify(first.meta.service.track), JSON.stringify(original))
  assert.equal(adapter.getServiceProvenance(JSON.parse(JSON.stringify(first))).endpoint, 'http://one:3124')
})

test('Vue reactive track metadata is fully cloneable at Electron IPC and worker boundaries', () => {
  const { reactive, isProxy } = require('vue')
  const row = reactive(original)
  assert.equal(isProxy(row.meta), true)
  const track = adapter.toServiceTrack(row, 'http://one:3124')
  assert.equal(isProxy(track.meta.service.track), false)
  const cloned = structuredClone(track)
  assert.equal(cloned.meta.service.track.meta.strMediaMid, 'media')
  assert.equal(cloned.meta.service.endpoint, 'http://one:3124')
})

test('Service playback precedes local preference and desktop provider SDK; safety errors and abort propagate', async() => {
  const calls = []
  const fail = () => { throw new Error('desktop provider must not run') }
  const dependencies = {
    './online': { getMusicUrl: fail, getPicUrl: fail, getLyricInfo: fail }, './download': {}, './local': {}, './utils': { isCustomApiSource: () => false },
    './preferLocal': { findLocalPlayback: fail }, '@renderer/store/setting': { appSetting: { 'player.preferLocal': true, 'player.playQuality': '128k' } },
    '@renderer/utils/message': { requestMsg: { cancelRequest: 'cancel' } },
    '@renderer/service/client': { ServiceClient: class { picture = async() => ({ url: '/api/v1/playback/resources/p/picture' }); resourceUrl = value => 'http://one:3124' + value; lyrics = async() => ({ lyric: 'server lyric' }) } },
    '@renderer/service/tracks': { ...adapter, resolveServiceTrack: async(service, quality) => { calls.push([service.endpoint, quality]); if (quality === 'flac') throw new api.ServiceError('TARGET_BLOCKED'); return { url: 'http://one:3124/api/v1/streams/fresh', quality } } },
  }
  const core = load('src/renderer/core/music/index.ts', dependencies)
  const track = adapter.toServiceTrack(original, 'http://one:3124')
  let route
  assert.equal(await core.getMusicUrl({ musicInfo: track, onResolved: info => { route = info } }), 'http://one:3124/api/v1/streams/fresh')
  assert.equal(route.mode, 'service')
  await core.getMusicUrl({ musicInfo: track, isRefresh: true }); assert.equal(calls.length, 2)
  await assert.rejects(core.getMusicUrl({ musicInfo: track, quality: 'flac' }), { code: 'TARGET_BLOCKED' })
  const signal = new AbortController(); signal.abort()
  await assert.rejects(core.getMusicUrl({ musicInfo: track, requestOptions: { signal: signal.signal } }), /cancel/)
  await assert.rejects(core.getMusicUrl({ musicInfo: track, requestOptions: { excludedUrls: new Set(['http://one:3124/api/v1/streams/fresh']) } }), /新的可播放线路/)
  assert.equal(await core.getPicPath({ musicInfo: track }), 'http://one:3124/api/v1/playback/resources/p/picture')
  assert.equal((await core.getLyricInfo({ musicInfo: track })).lyric, 'server lyric')
})

test('server library media never becomes a desktop filesystem path; native resource attribution is ephemeral', async() => {
  const track = adapter.toServiceTrack({ ...original, source: 'local' }, 'http://one:3124', { streamPath: '/api/v1/library/tracks/local1/stream' })
  const result = await adapter.resolveServiceTrack(track.meta.service, '320k')
  assert.equal(result.url, 'http://one:3124/api/v1/library/tracks/local1/stream')
  assert.ok(adapter.isResolvedServiceResource(track.meta.service, result.url))
  assert.equal(adapter.isResolvedServiceResource(JSON.parse(JSON.stringify(track)).meta.service, result.url), false)
  assert.throws(() => adapter.toServiceTrack(original, 'http://one:3124', { streamPath: '/etc/private.mp3' }), { code: 'INVALID_RESOURCE_URL' })
})

test('native history deduplicates pause/rebuffer; quick next closes correct pending ID on all desktop platforms', async() => {
  for (const [platform, expected] of [['darwin', 'macos'], ['win32', 'windows'], ['linux', 'linux']]) {
    const writes = []; const starts = []
    const historyApi = load('src/renderer/service/history.ts', { './client': api }, { process: { platform } })
    const tracker = new historyApi.ServicePlaybackHistory(() => assert.fail('history error'), endpoint => ({ request: async(path, method, body) => {
      writes.push({ endpoint, path, method, body })
      if (method === 'POST') return await new Promise(resolve => starts.push(resolve))
    } }))
    const service = { endpoint: 'http://one:3124', track: original }
    assert.equal(writes.length, 0)
    tracker.playing('one', service); tracker.playing('one', service)
    assert.equal(writes.length, 1); assert.equal(writes[0].body.platform, expected)
    tracker.progress(23, 180); tracker.progress(0, 0, 'two'); tracker.progress(0, 0, 'one'); tracker.end(false); tracker.end(true)
    tracker.playing('two', { ...service, endpoint: 'http://two:3124' })
    starts[0]({ playbackId: 'old-session' }); await new Promise(setImmediate)
    assert.equal(writes[2].endpoint, 'http://one:3124'); assert.equal(writes[2].body.lastPositionSeconds, 23)
    assert.equal(writes[2].body.completed, false)
    tracker.progress(180, 180); tracker.end(true); starts[1]({ playbackId: 'new-session' }); await new Promise(setImmediate)
    assert.equal(writes[3].body.completed, true); assert.equal(writes.length, 4)
  }
})

test('desktop history observes real matching audio events, ignores previous resources and samples native time', () => {
  const native = new Map(); const app = new Map(); const calls = []; let resourceMatches = false; let position = 12
  const track = adapter.toServiceTrack(original, 'http://one:3124')
  const state = { playMusicInfo: { musicInfo: track } }
  const nativeApi = { getCurrentTime: () => position, getDuration: () => 180, getResource: () => 'audio', ...Object.fromEntries(['onPlaying', 'onPause', 'onTimeupdate', 'onEnded'].map(name => [name, fn => { native.set(name, fn); return () => {} }])) }
  class History { playing(...args) { calls.push(['playing', ...args]) }; progress(...args) { calls.push(['progress', ...args]) }; end(...args) { calls.push(['end', ...args]) } }
  const init = load('src/renderer/core/useApp/usePlayer/useServiceHistory.ts', {
    '@common/utils/vueTools': { onBeforeUnmount() {} }, '@renderer/plugins/player': nativeApi, '@renderer/store/player/state': state,
    '@renderer/service/history': { ServicePlaybackHistory: History }, '@renderer/service/tracks': { ...adapter, isResolvedServiceResource: () => resourceMatches },
  }, { window: { app_event: { on: (name, fn) => app.set(name, fn), off() {} }, addEventListener() {}, removeEventListener() {} } }).default
  init(); native.get('onPlaying')(); assert.equal(calls.length, 0)
  resourceMatches = true; native.get('onPlaying')(); assert.equal(calls[0][0], 'playing')
  position = 36; native.get('onTimeupdate')(); assert.equal(calls.at(-1)[1], 36)
  native.get('onEnded')(); assert.deepEqual(calls.at(-1), ['end', true])
  state.playMusicInfo.musicInfo = null; native.get('onPlaying')(); assert.deepEqual(calls.at(-1), ['end', true])
})
module.exports = { load, api, adapter }

test('server downloads never create desktop filesystem/worker tasks', async() => {
  const writes = []
  const fail = () => assert.fail('local filesystem task was invoked')
  const action = load('src/renderer/store/download/action.ts', {
    '@renderer/utils/ipc': {}, './state': { downloadList: [] }, '@common/utils/vueTools': { markRaw: x => x, toRaw: x => x },
    '@renderer/core/music/online': {}, '../setting': { appSetting: {} }, '..': { qualityList: { value: {} } },
    '@renderer/worker/utils': {}, '@renderer/utils': {}, '@common/constants': { DOWNLOAD_STATUS: {} }, '../index': {}, './utils': {},
    '@renderer/service/tracks': adapter,
    '@renderer/service/client': { ServiceClient: class { constructor(endpoint) { this.endpoint = endpoint }; async download(track, quality) { writes.push({ endpoint: this.endpoint, track, quality }) } } },
    '@renderer/service/downloads': { downloadWithConfirmation: async(client, track, quality) => { await client.download(track, quality); return true } },
    '@renderer/plugins/Dialog': {}, '@renderer/service/session': {},
  }, { window: { lx: { worker: { download: { createDownloadTasks: fail } } } } })
  await action.createDownloadTasks([adapter.toServiceTrack(original, 'http://one:3124')], '320k')
  assert.equal(writes.length, 1); assert.equal(writes[0].endpoint, 'http://one:3124'); assert.equal(writes[0].quality, '320k')
  await action.createDownloadTasks([adapter.toServiceTrack({ ...original, source: 'local' }, 'http://one:3124', { streamPath: '/api/v1/library/tracks/file/stream' })], '128k')
  assert.equal(writes.length, 1, 'server library files are already downloaded')
})
