// Real Service + deterministic provider/media upstreams, isolated from user data.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const net = require('node:net')
const { spawn, spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const serverRoot = process.env.Q_SERVICE_ROOT || path.resolve(root, '../../lx-music-server-web')
const storage = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'qmusic-web-fixture-')))
const proof = process.env.Q_WEB_PROOF || path.join(root, 'artifacts/web-client/verification')
fs.mkdirSync(proof, { recursive: true })
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))
const requests = []
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jNOkAAAAASUVORK5CYII=', 'base64')
// Test-only encoder dependency; the shipped Web/Service does not require FFmpeg.
const audioPath = path.join(storage, 'fixture-audio.mp3')
const encoded = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=22050:cl=mono', '-t', '60', '-codec:a', 'libmp3lame', '-b:a', '128k', audioPath])
if (encoded.status !== 0) throw Error('FFmpeg is required to generate the disposable 60-second MP3 fixture')
const audio = fs.readFileSync(audioPath)
const lossless = process.env.Q_MEDIA_UPGRADE === '1'
let flac
if (lossless) {
  const file = path.join(storage, 'fixture-audio.flac')
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-t', '60', '-codec:a', 'flac', file])
  if (result.status !== 0) throw Error('Could not encode disposable FLAC fixture')
  flac = fs.readFileSync(file)
}
let script
const upstream = http.createServer((req, res) => {
  requests.push(req.url)
  fs.writeFileSync(path.join(proof, 'upstream-requests.json'), JSON.stringify(requests, null, 2))
  if (req.url === '/source.js') { res.end(script); return }
  if (req.url === '/picture.png') { res.setHeader('content-type', 'image/png'); res.end(png); return }
  const payload = req.url.endsWith('.flac') && flac ? flac : audio
  const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '')
  const start = match ? Number(match[1]) : 0
  const end = match?.[2] ? Math.min(Number(match[2]), payload.length - 1) : payload.length - 1
  res.writeHead(match ? 206 : 200, { 'content-type': payload === flac ? 'audio/flac' : 'audio/mpeg', 'content-length': end - start + 1, 'accept-ranges': 'bytes', ...(match ? { 'content-range': `bytes ${start}-${end}/${payload.length}` } : {}) })
  if (req.method === 'HEAD') { res.end(); return }
  // Slow enough to exercise task pause/resume without contacting the Internet.
  let offset = start
  const tick = () => { if (res.destroyed) return; const next = Math.min(offset + 65536, end + 1); res.write(payload.subarray(offset, next)); offset = next; if (offset > end) res.end(); else timer = setTimeout(tick, 200) }
  let timer; res.once('close', () => clearTimeout(timer)); tick()
})
const tracks = Array.from({ length: 80 }, (_, i) => ({ id: `fixture-${i + 1}`, name: `Web fixture ${i + 1}`, artist: `Fixture artist ${i + 1}`, album: `Fixture album ${i + 1}`, albumid: `fixture-album-${i + 1}`, duration: '60', N_MINFO: 'level:128k,bitrate:128,format:wav,size:3m' }))
const search = { TOTAL: '1', SHOW: '1', abslist: [{ MUSICRID: 'MUSIC_fixture-one', SONGNAME: 'Web fixture', ARTIST: 'Fixture artist', ALBUMID: 'fixture-album', ALBUM: 'Fixture album', DURATION: '60', N_MINFO: 'level:128k,bitrate:128,format:wav,size:3m' }], code: 200, data: { totalCount: 1, resources: [{ baseInfo: { simpleSongData: { id: 12345, name: 'Web fixture', dt: 60000, ar: [{ name: 'Fixture artist' }], al: { id: 99, name: 'Fixture album' }, privilege: { maxbr: 128000 } } } }] } }
const responseFor = line => {
  if (line.includes('getTagList')) return { code: 200, data: [{ id: 'group-1', name: 'Fixture group', data: [{ id: '42', name: 'Fixture tag', digest: '10000' }] }] }
  if (line.includes('getRcmTagList')) return { code: 200, data: [{ data: [{ id: '42', name: 'Fixture tag', digest: '10000' }] }] }
  if (line.includes('getTagPlayList') || line.includes('getRcmPlayList')) return { code: 200, data: { data: [{ id: '9001', digest: '8', name: 'Web fixture playlist', uname: 'Fixture', total: 80, listencnt: 1, favorcnt: 10, desc: 'QA', img: '' }], total: 1, pn: 1, rn: 36 } }
  if (line.includes('/pl.svc?')) return { result: 'ok', rn: 1000, total: 80, title: 'Web fixture playlist', pic: '', info: 'QA', uname: 'Fixture', playnum: 1, musiclist: tracks }
  return search
}
const proxy = http.createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(responseFor(req.url))) })
proxy.on('connect', (req, socket) => {
  if (req.url.startsWith('wbd.kuwo.cn:')) { socket.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n'); return }
  socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
  socket.once('data', chunk => {
    if (chunk[0] === 0x16) { socket.destroy(); return }
    const body = JSON.stringify(responseFor(chunk.toString().split('\r\n')[0]))
    socket.end(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`)
  })
})
let service
const stop = async() => {
  fs.writeFileSync(path.join(proof, 'upstream-requests.json'), JSON.stringify(requests, null, 2))
  if (service?.exitCode == null) { const done = new Promise(resolve => service.once('exit', resolve)); service.kill('SIGTERM'); await done }
  upstream.closeAllConnections(); upstream.close(); proxy.closeAllConnections(); proxy.close()
  // Keep only this disposable fixture for inspection/restart; no user data resides here.
  process.exit()
}
process.on('SIGINT', stop); process.on('SIGTERM', stop)
;(async() => {
  const [upstreamPort, proxyPort] = await Promise.all([listen(upstream), listen(proxy)])
  script = `/*\n * @name Web platform fallback fixture\n * @version 1.0.0\n */
window.tuneflow.on(window.tuneflow.EVENT_NAMES.request, async ({ source, action, info }) => {
  if (action === 'lyric') return { lyric: '[00:00]Web fixture lyric' }
  if (action === 'pic') return 'http://127.0.0.1:${upstreamPort}/picture.png'
  if (source === 'kw') throw new Error('recoverable fixture parse failure')
  return 'http://127.0.0.1:${upstreamPort}/audio-from-wy.' + (${lossless} && info.type === 'flac' ? 'flac' : 'mp3')
})
window.tuneflow.send(window.tuneflow.EVENT_NAMES.inited, { sources: { kw: { type: 'music', actions: ['musicUrl', 'lyric', 'pic'], qualitys: ${JSON.stringify(lossless ? ['128k', 'flac'] : ['128k'])} }, wy: { type: 'music', actions: ['musicUrl', 'lyric', 'pic'], qualitys: ${JSON.stringify(lossless ? ['128k', 'flac'] : ['128k'])} } } })`
  const sourcePath = path.join(storage, 'web-source.js'); fs.writeFileSync(sourcePath, script)
  const reservation = net.createServer(); const port = await listen(reservation); await new Promise(resolve => reservation.close(resolve))
  const log = fs.openSync(path.join(storage, 'service.log'), 'a')
  const webRoot = process.env.Q_WEB_ROOT || path.join(root, 'dist/web-client')
  service = spawn(process.execPath, ['dist/server/index.cjs'], { cwd: serverRoot, stdio: ['ignore', log, log], env: { ...process.env, NODE_ENV: 'test', HTTP_PROXY: `http://127.0.0.1:${proxyPort}`, HTTPS_PROXY: `http://127.0.0.1:${proxyPort}`, TUNEFLOW_TEST_ALLOW_PRIVATE_SOURCE_TARGETS: '1', TUNEFLOW_TEST_ALLOW_PRIVATE_PLAYBACK_TARGETS: '1', TUNEFLOW_STORAGE_ROOT: storage, TUNEFLOW_CONFIG_ROOT: '', TUNEFLOW_MEDIA_ROOT: '', TUNEFLOW_CACHE_ROOT: '', TUNEFLOW_TEMP_ROOT: '', TUNEFLOW_HOST: '127.0.0.1', TUNEFLOW_PORT: String(port), TUNEFLOW_WEB_ROOT: webRoot, TUNEFLOW_SERVICE_NODE_MODULES: path.join(serverRoot, 'dist/server/node_modules') } })
  const origin = `http://127.0.0.1:${port}`
  for (let i = 0; i < 100; i++) { if (service.exitCode != null) throw Error('Fixture Service exited'); try { if ((await fetch(origin + '/api/v1/health')).ok) break } catch {} await new Promise(resolve => setTimeout(resolve, 100)) }
  const request = async(url, method, body) => { const response = await fetch(origin + '/api/v1/' + url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); if (!response.ok) throw Error(url + ': ' + response.status); return (await response.json()).data }
  await request('playlists', 'POST', { position: 0, playlists: [{ id: 'web_keep', name: 'Existing fixture playlist' }] })
  const track = { id: 'fixture-one', source: 'kw', name: 'Web fixture', singer: 'Fixture artist', interval: '01:00', meta: { songId: 'fixture-one', albumName: 'Fixture album', qualitys: [{ type: '128k', size: null }] } }
  if (lossless) track.meta.qualitys.push({ type: 'flac', size: null })
  await request('playlists/web_keep/tracks', 'POST', { position: 'bottom', tracks: [track] })
  const info = { endpoint: origin, storage, webRoot, sourcePath, sourceUrl: `http://127.0.0.1:${upstreamPort}/source.js`, track, testOnly: true }
  fs.writeFileSync(path.join(proof, 'fixture.json'), JSON.stringify(info, null, 2))
  console.log(JSON.stringify(info))
})().catch(error => { console.error(error); process.exitCode = 1; void stop() })
