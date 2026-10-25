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
  const context = { exports: {}, fetch, AbortController, setTimeout, clearTimeout, ...globals, require: id => {
    if (id in dependencies) return dependencies[id]
    if (id.startsWith('.')) {
      const resolved = path.relative(path.join(__dirname, '..'), path.resolve(path.dirname(filename), `${id}.ts`))
      if (!cache.has(resolved)) cache.set(resolved, load(resolved))
      return cache.get(resolved)
    }
    throw new Error(`Unexpected dependency: ${id}`)
  } }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, context, { filename })
  return context.exports
}
const api = load('src/service/client.ts')
const adapter = load('src/service/tracks.ts', { './client': api })
const original = { id: 'tx_1', songmid: 'mid', source: 'tx', name: 'Song', singer: 'Artist', interval: '03:00', meta: { songId: 'mid', albumName: 'Album', strMediaMid: 'media', toggleMusicInfo: { id: 'wrong' } } }

test('server addresses reject credentials, traversal and non-HTTP schemes; resource URLs stay on the selected server', () => {
  assert.equal(api.normalizeEndpoint(' http://192.168.0.70:3124/ '), 'http://192.168.0.70:3124')
  assert.equal(api.normalizeEndpoint('https://music.example/service/'), 'https://music.example/service')
  assert.equal(api.normalizeEndpoint('http://[::1]:3124'), 'http://[::1]:3124')
  for (const value of ['file:///music', 'http://user:password@host', 'https://host/?secret=x', 'https://host/#x', 'http://host:0', 'http://host:65536', 'https://host/../private', 'https://host/%2e%2e', 'https://host/%2fprivate']) assert.throws(() => api.normalizeEndpoint(value), { code: 'INVALID_SERVER_ADDRESS' })
  const client = new api.ServiceClient('https://host')
  assert.equal(client.resourceUrl('/api/v1/streams/opaque'), 'https://host/api/v1/streams/opaque')
  for (const value of ['https://upstream/song.mp3', '//evil/file', '/api/v1/streams/../settings', '/api/v1/streams/%2e%2e/settings', '/api/v1/settings', '/api/v1/streams/key?redirect=evil']) assert.throws(() => client.resourceUrl(value), { code: 'INVALID_RESOURCE_URL' })
})

test('real HTTP transport: envelope, typed errors, 204, no cookies, and cancellation', async t => {
  const seen = []
  const server = http.createServer(async(req, res) => {
    seen.push(req)
    if (req.url.endsWith('/slow')) { req.on('close', () => {}); return }
    if (req.url.endsWith('/empty')) { res.writeHead(204).end(); return }
    if (req.url.endsWith('/html')) { res.writeHead(401).end('<html>proxy authentication</html>'); return }
    res.setHeader('content-type', 'application/json')
    if (req.url.endsWith('/failure')) { res.writeHead(502).end(JSON.stringify({ error: { code: 'RESPONSE_TOO_LARGE', message: 'private upstream URL' } })); return }
    if (req.url.endsWith('/invalid')) { res.end('{}'); return }
    res.end(JSON.stringify({ data: { ok: true } }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections(); server.close() })
  const client = new api.ServiceClient(`http://127.0.0.1:${server.address().port}`)
  assert.equal((await client.request('/api/v1/test', 'POST', { value: 1 })).ok, true)
  assert.equal(seen[0].headers.cookie, undefined)
  await assert.rejects(client.request('/api/v1/failure'), { code: 'RESPONSE_TOO_LARGE', status: 502 })
  await assert.rejects(client.request('/api/v1/invalid'), { code: 'INVALID_RESPONSE' })
  await assert.rejects(client.request('/api/v1/html'), { code: 'HTTP_401', status: 401 })
  assert.equal(await client.request('/api/v1/empty', 'DELETE'), undefined)
  const controller = new AbortController()
  const pending = client.request('/api/v1/slow', 'GET', undefined, controller.signal)
  controller.abort()
  await assert.rejects(pending, { code: 'CANCELLED' })
})

test('DTO preserves provider identifiers and endpoint provenance without sharing short-lived URL caches', async() => {
  const first = adapter.toServiceTrack(original, 'http://one:3124')
  const second = adapter.toServiceTrack({ ...original, source: 'wy' }, 'http://one:3124')
  const third = adapter.toServiceTrack(original, 'http://two:3124')
  assert.equal(new Set([first.id, second.id, third.id]).size, 3)
  assert.equal(first.meta.songId, 'mid')
  assert.equal(first.meta.strMediaMid, 'media')
  assert.equal(first.meta.service.track, original)
  assert.equal(first.meta.toggleMusicInfo, undefined)
  assert.equal(first.meta._qualitys['128k'].size, null)
  const restored = JSON.parse(JSON.stringify(first))
  assert.equal(adapter.getServiceProvenance(restored).endpoint, 'http://one:3124')
  const lyric = adapter.serviceLyrics({ lyric: '[00:01]Song', tlyric: '[00:01]歌词' })
  assert.equal(lyric.rawlrcInfo.lyric, lyric.lyric)
  assert.equal(lyric.tlyric, '[00:01]歌词')
})

test('remote core dispatch precedes preferLocal and native SDK; errors never fall back to phone providers', async() => {
  const calls = []
  const fail = () => { throw new Error('phone provider must not run') }
  const dependencies = {
    './online': { getMusicUrl: fail, getMusicPlayUrlInfo: fail, getPicUrl: fail, getLyricInfo: fail },
    './download': {}, './local': {}, './preferLocal': { findLocalPlayback: fail },
    '@/store/setting/state': { setting: { 'player.preferLocal': true } },
    '@/service/client': { ServiceClient: class { picture = async() => ({ url: '/api/v1/playback/resources/p/picture' }); resourceUrl = value => 'http://one:3124' + value; lyrics = async() => ({ lyric: 'server lyric' }) } },
    '@/service/tracks': { ...adapter, resolveServiceTrack: async(service, quality) => { calls.push([service.endpoint, quality]); if (quality === 'flac') throw new api.ServiceError('TARGET_BLOCKED'); return { url: 'http://one:3124/api/v1/streams/fresh', quality: quality ?? '128k' } } },
  }
  const core = load('src/core/music/index.ts', dependencies)
  const track = adapter.toServiceTrack(original, 'http://one:3124')
  assert.equal((await core.getMusicPlayUrlInfo({ musicInfo: track })).url, 'http://one:3124/api/v1/streams/fresh')
  assert.equal(await core.getMusicUrl({ musicInfo: track, isRefresh: true }), 'http://one:3124/api/v1/streams/fresh')
  assert.equal(calls.length, 2, 'Every play/refresh resolves a fresh server token')
  await assert.rejects(core.getMusicUrl({ musicInfo: track, quality: 'flac' }), { code: 'TARGET_BLOCKED' })
  assert.equal(await core.getPicPath({ musicInfo: track }), 'http://one:3124/api/v1/playback/resources/p/picture')
  assert.equal((await core.getLyricInfo({ musicInfo: track })).lyric, 'server lyric')
})

test('server library playback uses only opaque library paths, never a phone file path', async() => {
  const track = adapter.toServiceTrack({ ...original, source: 'local' }, 'http://one:3124', { streamPath: '/api/v1/library/tracks/local1/stream' })
  assert.equal((await adapter.resolveServiceTrack(track.meta.service, '320k')).url, 'http://one:3124/api/v1/library/tracks/local1/stream')
  assert.throws(() => adapter.toServiceTrack(original, 'http://one:3124', { streamPath: '/etc/private.mp3' }), { code: 'INVALID_RESOURCE_URL' })
})

test('history starts only on native playing; pause/rebuffer does not duplicate, fast next closes the original session once', async() => {
  const writes = []
  const starts = []
  const historyApi = load('src/service/history.ts', { './client': api })
  const tracker = new historyApi.ServicePlaybackHistory(() => { throw new Error('history error') }, endpoint => ({
    request: async(path, method, body) => {
      writes.push({ endpoint, path, method, body })
      if (method === 'POST') return await new Promise(resolve => { starts.push(resolve) })
    },
  }))
  assert.equal(writes.length, 0)
  const service = { endpoint: 'http://one:3124', track: original }
  tracker.playing('one', service)
  tracker.playing('one', service)
  assert.equal(writes.length, 1)
  assert.equal(writes[0].body.platform, 'android')
  tracker.progress(23, 180)
  tracker.progress(0, 0, 'two')
  tracker.progress(0, 0, 'one')
  tracker.end(false)
  tracker.end(true)
  tracker.playing('two', { ...service, endpoint: 'http://two:3124' })
  starts[0]({ playbackId: 'old-session' })
  await new Promise(setImmediate)
  assert.equal(writes[2].endpoint, 'http://one:3124')
  assert.equal(writes[2].path, '/api/v1/playback/history/old-session')
  assert.equal(writes[2].body.lastPositionSeconds, 23)
  assert.equal(writes[2].body.completed, false)
  tracker.progress(180, 180)
  tracker.end(true)
  starts[1]({ playbackId: 'new-session' })
  await new Promise(setImmediate)
  assert.equal(writes[3].body.completed, true)
  assert.equal(writes.length, 4)
})

test('native history observes real audio during Q URL-loading guard, samples native progress, and excludes placeholders/old tracks', async() => {
  const handlers = new Map()
  const appHandlers = new Map()
  const stateHandlers = new Map()
  const calls = []
  const timers = new Map()
  const track = adapter.toServiceTrack(original, 'http://one:3124')
  const player = { playMusicInfo: { musicInfo: track }, progress: { nowPlayTime: 0, maxPlayTime: 0 } }
  let nativeTrack = { id: `${track.id}__//random__//default`, musicId: track.id }
  let nativeState = 'playing'
  let position = 12
  const native = { addEventListener: (event, fn) => handlers.set(event, fn), getCurrentTrack: async() => 0, getTrack: async() => nativeTrack, getState: async() => nativeState, getPosition: async() => position, getDuration: async() => 180 }
  class History {
    playing(...args) { calls.push(['playing', ...args]) }
    progress(...args) { calls.push(['progress', ...args]) }
    end(...args) { calls.push(['end', ...args]) }
  }
  const init = load('src/core/init/player/serviceHistory.ts', {
    '@/store/player/state': player, '@/service/tracks': adapter,
    '@/service/history': { ServicePlaybackHistory: History },
    'react-native-track-player': { __esModule: true, default: native, Event: { PlaybackState: 'state', PlaybackTrackChanged: 'track' }, State: { Playing: 'playing', Paused: 'paused', Stopped: 'stopped', None: 'none' } },
    'react-native-background-timer': { setInterval: fn => { timers.set(1, fn); return 1 }, clearInterval: id => timers.delete(id) },
  }, { global: { lx: { gettingUrlId: 'still-loading' }, app_event: { on: (name, fn) => appHandlers.set(name, fn) }, state_event: { on: (name, fn) => stateHandlers.set(name, fn) } }, console }).default
  init()
  handlers.get('state')({ state: 'playing' })
  await new Promise(setImmediate)
  assert.equal(calls.length, 0, 'Placeholder never starts history')
  nativeTrack = { id: `${track.id}__//random__//opaque`, musicId: track.id }
  handlers.get('state')({ state: 'playing' })
  await new Promise(setImmediate)
  assert.equal(calls[0][0], 'playing')
  assert.ok(calls.some(call => call[0] === 'progress' && call[1] === 12 && call[2] === 180))
  position = 36
  timers.get(1)()
  await new Promise(setImmediate)
  assert.ok(calls.some(call => call[0] === 'progress' && call[1] === 36))
  nativeState = 'paused'
  handlers.get('state')({ state: 'paused' })
  await new Promise(setImmediate)
  assert.equal(timers.size, 0)
  const started = calls.filter(call => call[0] === 'playing').length
  nativeState = 'playing'
  nativeTrack = { id: 'other__//opaque', musicId: 'other' }
  handlers.get('track')()
  await new Promise(setImmediate)
  assert.equal(calls.filter(call => call[0] === 'playing').length, started)
  appHandlers.get('musicToggled')()
  assert.deepEqual(calls[calls.length - 1], ['end', false])
})

module.exports = { load, api, adapter }
