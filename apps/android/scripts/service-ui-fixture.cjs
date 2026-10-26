// Disposable localhost Service for native UI verification. Never points at Docker data.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const http = require('node:http')
const serverRoot = process.env.Q_SERVICE_ROOT || path.resolve(__dirname, '../../..', 'lx-music-server-web')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qmusic-native-fixture-'))
fs.mkdirSync(path.join(root, 'audio'))
const sampleRate = 22050
const wave = Buffer.alloc(44 + 70 * sampleRate * 2)
wave.write('RIFF'); wave.writeUInt32LE(wave.length - 8, 4); wave.write('WAVEfmt ', 8)
wave.writeUInt32LE(16, 16); wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22)
wave.writeUInt32LE(sampleRate, 24); wave.writeUInt32LE(sampleRate * 2, 28); wave.writeUInt16LE(2, 32); wave.writeUInt16LE(16, 34)
wave.write('data', 36); wave.writeUInt32LE(wave.length - 44, 40)
for (let i = 0; i < 70 * sampleRate; i++) wave.writeInt16LE(Math.round(Math.sin(i * 440 * 2 * Math.PI / sampleRate) * 500), 44 + i * 2)
fs.writeFileSync(path.join(root, 'audio', 'Fixture Native - QMusic QA.wav'), wave)
fs.writeFileSync(path.join(root, 'audio', 'Fixture Native - QMusic QA.lrc'), '[00:00.00]Native Service fixture\n[00:30.00]Seek point\n[01:00.00]Native end')
const mp3 = fs.readFileSync(path.join(serverRoot, 'src/renderer/assets/medias/Silence02s.mp3'))
const upstream = http.createServer((req, res) => {
  const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '')
  const start = match ? Number(match[1]) : 0
  const end = match && match[2] ? Math.min(Number(match[2]), mp3.length - 1) : mp3.length - 1
  res.writeHead(match ? 206 : 200, { 'content-type': 'audio/mpeg', 'content-length': end - start + 1, 'accept-ranges': 'bytes', ...(match ? { 'content-range': `bytes ${start}-${end}/${mp3.length}` } : {}) })
  res.end(mp3.subarray(start, end + 1))
})
let service
const stop = async() => {
  if (service && service.exitCode == null) { const done = new Promise(resolve => service.once('exit', resolve)); service.kill('SIGTERM'); await done }
  upstream.closeAllConnections(); upstream.close()
  fs.rmSync(root, { recursive: true, force: true })
  process.exit()
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
upstream.listen(0, '127.0.0.1', async() => {
  const upstreamPort = upstream.address().port
  service = spawn(process.execPath, ['dist/server/index.cjs'], {
    cwd: serverRoot,
    env: { ...process.env, NODE_ENV: 'test', TUNEFLOW_TEST_ALLOW_PRIVATE_SOURCE_TARGETS: '1', TUNEFLOW_TEST_ALLOW_PRIVATE_PLAYBACK_TARGETS: '1', TUNEFLOW_STORAGE_ROOT: root, TUNEFLOW_CONFIG_ROOT: '', TUNEFLOW_MEDIA_ROOT: '', TUNEFLOW_CACHE_ROOT: '', TUNEFLOW_TEMP_ROOT: '', TUNEFLOW_HOST: '127.0.0.1', TUNEFLOW_PORT: '43124', TUNEFLOW_WEB_ROOT: path.join(serverRoot, 'dist/web'), TUNEFLOW_SERVICE_NODE_MODULES: path.join(serverRoot, 'dist/server/node_modules') },
    stdio: ['ignore', 'ignore', 'inherit'],
  })
  const origin = 'http://127.0.0.1:43124'
  for (let i = 0; i < 100; i++) {
    if (service.exitCode != null) throw new Error('Temporary Service stopped')
    try { if ((await fetch(origin + '/api/v1/health')).ok) break } catch {}
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  const request = async(url, method, body) => {
    const response = await fetch(origin + '/api/v1/' + url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    if (!response.ok) throw new Error('Fixture initialization failed: ' + response.status)
    return (await response.json()).data
  }
  const script = `/*\n * @name Native UI fixture\n * @version 1.0.0\n */
window.tuneflow.on(window.tuneflow.EVENT_NAMES.request, async ({ action }) => action === 'lyric' ? { lyric: '[00:00]Fixture lyric' } : 'http://127.0.0.1:${upstreamPort}/fixture.mp3')
window.tuneflow.send(window.tuneflow.EVENT_NAMES.inited, { sources: { kw: { type: 'music', actions: ['musicUrl', 'lyric'], qualitys: ['128k'] } } })`
  const source = await request('sources', 'POST', { script })
  await request('sources/enabled', 'PUT', { sourceIds: [source.id] })
  await request('playlists', 'POST', { position: 0, playlists: [{ id: 'native_fixture', name: 'Native Fixture Playlist' }] })
  await request('playlists/native_fixture/tracks', 'POST', { position: 'bottom', tracks: [{ id: 'fixture_kw_1', source: 'kw', name: 'Fixture Download', singer: 'QMusic QA', interval: '00:01', meta: { songId: 'fixture-one', albumName: 'QA', qualitys: [{ type: '128k', size: null }], _qualitys: { '128k': { size: null } } } }] })
  console.log(JSON.stringify({ ready: true, endpoint: origin, storage: root, source: source.id }))
})
