const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs')
const { spawn } = require('node:child_process')
const { api } = require('./verify-service-client.cjs')

const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

test('Q client → actual isolated Service: search, playlist CRUD, sources, playback/Range/lyrics/artwork, downloads/library, history/settings', { timeout: 120000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qmusic-service-contract-'))
  const serverRoot = process.env.Q_SERVICE_ROOT || path.resolve(__dirname, '../../..', 'lx-music-server-web')
  const wave = fs.readFileSync(path.join(serverRoot, 'src/renderer/assets/medias/Silence02s.mp3'))
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jNOkAAAAASUVORK5CYII=', 'base64')
  let script = ''
  const upstream = http.createServer((req, res) => {
    if (req.url === '/source.js') { res.setHeader('content-type', 'application/javascript'); res.end(script); return }
    if (req.url === '/picture.png') { res.setHeader('content-type', 'image/png'); res.end(png); return }
    const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '')
    const start = match ? Number(match[1]) : 0
    const end = match && match[2] ? Math.min(Number(match[2]), wave.length - 1) : wave.length - 1
    res.writeHead(match ? 206 : 200, { 'content-type': 'audio/mpeg', 'accept-ranges': 'bytes', 'content-length': end - start + 1, ...(match ? { 'content-range': `bytes ${start}-${end}/${wave.length}` } : {}) })
    const firstEnd = Math.min(start + 128, end + 1)
    res.write(wave.subarray(start, firstEnd))
    if (firstEnd > end) { res.end(); return }
    const timer = setTimeout(() => res.end(wave.subarray(firstEnd, end + 1)), 500)
    res.once('close', () => { clearTimeout(timer) })
  })
  const upstreamPort = await listen(upstream)
  script = `/*\n * @name Q Service contract fixture\n * @version 1.0.0\n */
window.tuneflow.on(window.tuneflow.EVENT_NAMES.request, async ({ action }) => {
  if (action === 'lyric') return { lyric: '[00:01]Fixture lyric', tlyric: '[00:01]测试歌词' }
  if (action === 'pic') return 'http://127.0.0.1:${upstreamPort}/picture.png'
  return 'http://127.0.0.1:${upstreamPort}/audio.mp3'
})
window.tuneflow.send(window.tuneflow.EVENT_NAMES.inited, { sources: { kw: { type: 'music', actions: ['musicUrl', 'lyric', 'pic'], qualitys: ['128k'] } } })`
  const providerBody = JSON.stringify({ TOTAL: '1', SHOW: '1', abslist: [{ MUSICRID: 'MUSIC_fixture-one', SONGNAME: 'Q Service fixture', ARTIST: 'Fixture artist', ALBUMID: 'fixture-album', ALBUM: 'Fixture album', DURATION: '12', N_MINFO: 'level:128k,bitrate:128,format:wav,size:1m' }] })
  const proxy = http.createServer((_req, res) => { res.setHeader('content-type', 'application/json'); res.end(providerBody) })
  proxy.on('connect', (_req, socket) => {
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
    socket.once('data', () => socket.end(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(providerBody)}\r\nConnection: close\r\n\r\n${providerBody}`))
  })
  const proxyPort = await listen(proxy)
  const reservation = net.createServer()
  const servicePort = await listen(reservation)
  await new Promise(resolve => reservation.close(resolve))
  const service = spawn(process.execPath, ['dist/server/index.cjs'], {
    cwd: serverRoot,
    env: { ...process.env, NODE_ENV: 'test', HTTP_PROXY: `http://127.0.0.1:${proxyPort}`, TUNEFLOW_TEST_ALLOW_PRIVATE_SOURCE_TARGETS: '1', TUNEFLOW_TEST_ALLOW_PRIVATE_PLAYBACK_TARGETS: '1', TUNEFLOW_STORAGE_ROOT: root, TUNEFLOW_CONFIG_ROOT: '', TUNEFLOW_MEDIA_ROOT: '', TUNEFLOW_CACHE_ROOT: '', TUNEFLOW_TEMP_ROOT: '', TUNEFLOW_HOST: '127.0.0.1', TUNEFLOW_PORT: String(servicePort), TUNEFLOW_WEB_ROOT: path.join(serverRoot, 'dist/web'), TUNEFLOW_SERVICE_NODE_MODULES: path.join(serverRoot, 'dist/server/node_modules') },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  let diagnostics = ''
  service.stderr.on('data', chunk => { diagnostics += chunk.toString() })
  t.after(async() => {
    if (service.exitCode == null) { const exited = new Promise(resolve => service.once('exit', resolve)); service.kill('SIGTERM'); await exited }
    upstream.closeAllConnections(); upstream.close(); proxy.closeAllConnections(); proxy.close()
    fs.rmSync(root, { recursive: true, force: true })
  })
  const client = new api.ServiceClient(`http://127.0.0.1:${servicePort}`)
  let ready = false
  for (let i = 0; i < 80; i++) {
    if (service.exitCode != null) throw new Error(`Isolated Service exited: ${diagnostics}`)
    try { await client.connect(); ready = true; break } catch { await delay(100) }
  }
  assert.ok(ready, 'Isolated Service started')
  const source = await client.importSource(`http://127.0.0.1:${upstreamPort}/source.js`)
  await client.enableSources([source.id])
  assert.equal((await client.sources())[0].enabled, true)
  const results = await client.search('kw', 'fixture')
  assert.equal(results.list[0].name, 'Q Service fixture')
  const track = results.list[0]
  await client.createPlaylist('Test playlist', 'qmusic_contract')
  await client.addTracks('qmusic_contract', [track])
  assert.equal((await client.playlist('qmusic_contract')).tracks.length, 1)
  await client.renamePlaylist('qmusic_contract', 'Renamed playlist')
  assert.ok((await client.playlists()).some(list => list.name === 'Renamed playlist'))
  assert.ok((await client.playlists()).some(list => list.name === '默认列表'))
  const resolved = await client.resolve(track, '128k')
  const range = await fetch(client.resourceUrl(resolved.url), { headers: { Range: 'bytes=0-127' } })
  assert.equal(range.status, 206)
  assert.equal((await range.arrayBuffer()).byteLength, 128)
  assert.ok((await client.lyrics(track)).lyric.includes('Fixture lyric'))
  const picture = await client.picture(track)
  assert.equal((await fetch(client.resourceUrl(picture.url))).status, 200)
  const session = await client.request('/api/v1/playback/history', 'POST', { track, platform: 'android' })
  await client.request(`/api/v1/playback/history/${session.playbackId}`, 'PATCH', { completed: false, lastPositionSeconds: 5, durationSeconds: 12 })
  assert.equal((await client.request('/api/v1/playback/history'))[0].lastPositionSeconds, 5)
  const settings = await client.settings()
  await client.patchSettings({ 'download.maxDownloadNum': 1 })
  assert.equal((await client.settings())['download.maxDownloadNum'], 1)
  await client.patchSettings({ 'download.maxDownloadNum': settings['download.maxDownloadNum'] })
  const job = await client.download(track, '128k')
  await delay(100)
  await client.downloadAction(job.id, 'pause')
  assert.equal((await client.downloads()).find(item => item.id === job.id).status, 'paused')
  await client.downloadAction(job.id, 'resume')
  let completed = false
  for (let i = 0; i < 160; i++) {
    const current = (await client.downloads()).find(item => item.id === job.id)
    if (current.status === 'error') throw new Error(`Fixture download failed: ${current.error}`)
    if (current.status === 'completed') { completed = true; break }
    await delay(100)
  }
  assert.ok(completed, 'Server download completed')
  const library = await client.library()
  assert.ok(library.length > 0)
  assert.equal((await fetch(client.resourceUrl(library[0].streamUrl), { headers: { Range: 'bytes=0-43' } })).status, 206)
  await client.deleteDownload(job.id)
  assert.equal((await client.downloads()).length, 0)
  assert.equal((await client.library()).length, library.length, 'Removing task preserves server media')
  await client.removeTracks('qmusic_contract', [track.id])
  assert.equal((await client.playlist('qmusic_contract')).tracks.length, 0)
  await client.deletePlaylist('qmusic_contract')
  assert.ok(!(await client.playlists()).some(list => list.id === 'qmusic_contract'))
})
