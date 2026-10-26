const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs')
const { spawn } = require('node:child_process')
const { api, adapter, load } = require('./verify-service-client.cjs')
const domain = load('src/renderer/service/workspace.ts', { './client': api, './tracks': adapter })
const androidApi = load('../android/src/service/client.ts')
const androidTracks = load('../android/src/service/tracks.ts', { './client': androidApi })
const androidDomain = load('../android/src/service/workspace.ts', { './client': androidApi, './tracks': androidTracks })

const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

test('Q client → actual isolated Service: search, playlist CRUD, sources, playback/Range/lyrics/artwork, downloads/library, history/settings', { timeout: 120000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qmusic-service-contract-'))
  const serverRoot = process.env.Q_SERVICE_ROOT || path.resolve(__dirname, '../..', 'service')
  const wave = fs.readFileSync(path.join(serverRoot, 'src/renderer/assets/medias/Silence02s.mp3'))
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jNOkAAAAASUVORK5CYII=', 'base64')
  let script = ''
  const mediaRequests = []
  const upstream = http.createServer((req, res) => {
    mediaRequests.push(req.url)
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
  const providerBody = JSON.stringify({ TOTAL: '1', SHOW: '1', abslist: [{ MUSICRID: 'MUSIC_fixture-one', SONGNAME: 'Q Service fixture', ARTIST: 'Fixture artist', ALBUMID: 'fixture-album', ALBUM: 'Fixture album', DURATION: '12', N_MINFO: 'level:128k,bitrate:128,format:wav,size:1m' }], code: 200, data: { totalCount: 1, resources: [{ baseInfo: { simpleSongData: { id: 12345, name: 'Q Service fixture', dt: 12000, ar: [{ name: 'Fixture artist' }], al: { id: 99, name: 'Fixture album' }, privilege: { maxbr: 128000 } } } }] } })
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
  const desktop = new domain.ServiceWorkspace(client)
  const android = new androidDomain.ServiceWorkspace(new androidApi.ServiceClient(client.endpoint))
  const source = await client.importSource(`http://127.0.0.1:${upstreamPort}/source.js`)
  await client.enableSources([source.id])
  assert.equal((await client.sources())[0].enabled, true)
  const results = await client.search('kw', 'fixture')
  assert.equal(results.list[0].name, 'Q Service fixture')
  const track = results.list[0]
  const nativeTrack = (await desktop.search('kw', 'fixture')).list[0]
  assert.equal(nativeTrack.meta.service.endpoint, client.endpoint)
  await desktop.lists('add', { position: 2, listInfos: [{ id: 'unified_native', name: 'Unified native playlist' }] })
  await desktop.lists('music_add', { id: 'unified_native', musicInfos: [nativeTrack], addMusicLocationType: 'bottom' })
  assert.equal((await android.tracks('unified_native'))[0].meta.service.track.id, track.id, 'Android sees the native desktop write')
  await android.lists('music_add', { id: 'love', musicInfos: [(await android.tracks('unified_native'))[0]], addMusicLocationType: 'bottom' })
  assert.equal((await desktop.tracks('love'))[0].id, nativeTrack.id, 'Desktop favorite reads the same server identity')
  assert.equal(await desktop.lists('music_check_exist', { listId: 'love', musicInfoId: nativeTrack.id }), true)
  const tempBefore = await client.playlist('temp')
  await desktop.lists('music_overwrite', { listId: 'temp', musicInfos: [nativeTrack] })
  assert.equal((await desktop.tracks('temp')).length, 1)
  assert.equal((await android.tracks('temp')).length, 0, 'Playback queue is per device')
  assert.equal(JSON.stringify(await client.playlist('temp')), JSON.stringify(tempBefore), 'Device queue never overwrites server data')
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
  const platform = { darwin: 'macos', win32: 'windows', linux: 'linux' }[process.platform] ?? 'other'
  const session = await client.request('/api/v1/playback/history', 'POST', { track, platform })
  await client.request(`/api/v1/playback/history/${session.playbackId}`, 'PATCH', { completed: false, lastPositionSeconds: 5, durationSeconds: 12 })
  assert.equal((await client.request('/api/v1/playback/history'))[0].lastPositionSeconds, 5)
  assert.equal((await android.tracks(androidDomain.HISTORY_ID))[0].meta.service.track.id, track.id)
  const settings = await client.settings()
  await client.patchSettings({ 'download.maxDownloadNum': 1 })
  assert.equal((await client.settings())['download.maxDownloadNum'], 1)
  assert.equal((await android.client.settings())['download.maxDownloadNum'], 1, 'Shared settings agree across clients')
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
  const nativeLibrary = await desktop.tracks(domain.LIBRARY_ID)
  assert.equal(nativeLibrary[0].meta.service.streamPath, library[0].streamUrl)
  await desktop.lists('music_add', { id: 'unified_native', musicInfos: nativeLibrary, addMusicLocationType: 'bottom' })
  const restoredLibrary = (await android.tracks('unified_native')).find(item => item.meta.service.track.source === 'local')
  assert.equal(restoredLibrary.meta.service.streamPath, library[0].streamUrl, 'Server library identity survives playlist serialization')
  assert.equal((await fetch(android.client.resourceUrl(restoredLibrary.meta.service.streamPath), { headers: { Range: 'bytes=0-43' } })).status, 206)
  await assert.rejects(desktop.lists('remove', [domain.LIBRARY_ID]), { code: 'LIBRARY_IS_READ_ONLY' })
  await assert.rejects(android.lists('music_overwrite', { listId: androidDomain.HISTORY_ID, musicInfos: [] }), { code: 'LIBRARY_IS_READ_ONLY' })
  assert.throws(() => android.original(adapter.toServiceTrack(track, 'http://other-server')), { code: 'DIFFERENT_SERVER' })
  assert.throws(() => desktop.original({ id: 'device', source: 'local', meta: { filePath: '/device/private.mp3' } }), { code: 'DEVICE_FILE_NOT_IN_SERVER_LIBRARY' })
  assert.equal((await fetch(client.resourceUrl(library[0].streamUrl), { headers: { Range: 'bytes=0-43' } })).status, 206)
  await client.deleteDownload(job.id)
  assert.equal((await client.downloads()).length, 0)
  assert.equal((await client.library()).length, library.length, 'Removing task preserves server media')

  // The same server setting drives native desktop, Web and Android playback.
  // Use real history adapters: selection/resolve alone must not create a task.
  const autoTrack = { ...track, id: 'auto-save-contract', name: 'Automatic save fixture' }
  await android.client.patchSettings({ 'player.autoDownloadOnPlay': true, 'download.enable': false })
  assert.equal((await client.settings())['player.autoDownloadOnPlay'], true)
  await client.resolve(autoTrack, '128k')
  assert.equal((await client.downloads()).length, 0, 'Resolve/preload alone does not download')
  const errors = []
  const DesktopHistory = load('src/renderer/service/history.ts', { './client': api }).ServicePlaybackHistory
  const AndroidHistory = load('../android/src/service/history.ts', { './client': androidApi }).ServicePlaybackHistory
  const desktopHistory = new DesktopHistory(() => errors.push('desktop'))
  const androidHistory = new AndroidHistory(() => errors.push('android'))
  const provenance = { endpoint: client.endpoint, track: autoTrack }
  desktopHistory.playing('auto-desktop', provenance)
  desktopHistory.playing('auto-desktop', provenance)
  androidHistory.playing('auto-android', provenance)
  let autoJob
  for (let i = 0; i < 160; i++) {
    autoJob = (await client.downloads()).find(item => item.musicInfo.id === autoTrack.id)
    if (autoJob?.status === 'error') throw Error('Automatic download failed: ' + autoJob.error)
    if (autoJob?.status === 'completed') break
    await delay(100)
  }
  assert.equal(autoJob?.status, 'completed', 'Playback creates a real server file even with manual downloads disabled')
  assert.equal((await client.downloads()).length, 1, 'Repeated and cross-client starts reuse one download')
  const autoLibrary = (await client.library()).find(item => item.name === autoTrack.name)
  assert.ok(autoLibrary)
  assert.equal((await fetch(client.resourceUrl(autoLibrary.streamUrl), { headers: { Range: 'bytes=0-43' } })).status, 206)
  const localHistory = await client.request('/api/v1/playback/history', 'POST', { track: { id: autoLibrary.id, source: 'local' }, platform: 'web' })
  await delay(100)
  assert.equal((await client.downloads()).length, 1, 'Server library playback does not download again')
  await client.patchSettings({ 'player.autoDownloadOnPlay': false })
  assert.equal((await android.client.settings())['player.autoDownloadOnPlay'], false)
  androidHistory.playing('disabled', { ...provenance, track: { ...autoTrack, id: 'disabled-auto-save', name: 'Disabled auto save' } })
  await delay(100)
  assert.equal((await client.downloads()).length, 1, 'Disabling the shared setting stops future automatic downloads')
  desktopHistory.end(false); androidHistory.end(false)
  await client.request(`/api/v1/playback/history/${localHistory.playbackId}`, 'PATCH', { completed: false, lastPositionSeconds: 1, durationSeconds: 12 })
  await delay(100)
  assert.deepEqual(errors, [])
  await client.deleteDownload(autoJob.id)
  await client.request(`/api/v1/library/tracks/${encodeURIComponent(autoLibrary.id)}`, 'DELETE')
  await client.patchSettings({ 'download.enable': settings['download.enable'] })
  await client.removeTracks('qmusic_contract', [track.id])
  assert.equal((await client.playlist('qmusic_contract')).tracks.length, 0)
  await client.deletePlaylist('qmusic_contract')
  assert.ok(!(await client.playlists()).some(list => list.id === 'qmusic_contract'))
  await android.lists('music_remove', { listId: 'love', ids: [nativeTrack.id] })
  assert.equal((await desktop.tracks('love')).length, 0)
  await desktop.lists('remove', ['unified_native'])
  // Remove only this test's disposable download so preferLocal cannot satisfy
  // the fallback scenario before any source worker is called.
  await client.request(`/api/v1/library/tracks/${encodeURIComponent(library[0].id)}`, 'DELETE')

  // The requested platform fails inside an actual source worker. The genuine
  // catalog adapter finds the matching WY track through a deterministic proxy.
  const fallbackScript = `/*\n * @name Unified platform fallback fixture\n * @version 1.0.0\n */
window.tuneflow.on(window.tuneflow.EVENT_NAMES.request, async ({ source, action }) => {
  if (action === 'lyric') return { lyric: '[00:00]Fallback fixture' }
  if (action === 'pic') return 'http://127.0.0.1:${upstreamPort}/picture.png'
  if (source === 'kw') throw new Error('recoverable fixture parse failure')
  return 'http://127.0.0.1:${upstreamPort}/audio-from-wy.mp3'
})
window.tuneflow.send(window.tuneflow.EVENT_NAMES.inited, { sources: { kw: { type: 'music', actions: ['musicUrl', 'lyric', 'pic'], qualitys: ['128k'] }, wy: { type: 'music', actions: ['musicUrl', 'lyric', 'pic'], qualitys: ['128k'] } } })`
  const fallbackSource = await client.request('/api/v1/sources', 'POST', { script: fallbackScript })
  await client.enableSources([fallbackSource.id])
  const beforeFallback = mediaRequests.length
  const fallbackResolved = await client.resolve(track, '128k')
  const fallbackAudio = await fetch(client.resourceUrl(fallbackResolved.url), { headers: { Range: 'bytes=0-127' } })
  assert.equal(fallbackAudio.status, 206)
  assert.ok(mediaRequests.slice(beforeFallback).some(url => url.startsWith('/audio-from-wy.mp3')), 'Recoverable KW parsing failure actually switches to WY and streams audio')
  const androidFallback = await android.client.resolve(track, '128k')
  assert.equal((await fetch(android.client.resourceUrl(androidFallback.url), { headers: { Range: 'bytes=0-127' } })).status, 206)

  const desktopAccounts = load('src/renderer/service/accountLibrary.ts', { './client': api })
  const androidAccounts = load('../android/src/service/accountLibrary.ts', { './client': androidApi })
  const account = { provider: 'tx', owner: 'a'.repeat(32), id: 'dir:201', name: 'Shared account playlist' }
  const accountSong = { ...track, source: 'tx', id: 'tx_account_fixture', meta: { ...track.meta, songId: 'fixture-mid', strMediaMid: 'fixture-media', cookie: 'never-send-this', officialUrl: 'https://official.invalid/secret' } }
  const imported = await desktopAccounts.importAccountCollection(desktop, account, [accountSong], async() => {})
  const remote = await android.tracks(imported.id)
  assert.equal(remote[0].meta.service.track.source, 'tx')
  assert.ok(!JSON.stringify(remote[0].meta.service.track).includes('never-send-this'))
  await android.lists('music_add', { id: imported.id, musicInfos: [android.native(track)], addMusicLocationType: 'bottom' })
  const repeated = await androidAccounts.importAccountCollection(android, account, [accountSong], async() => {})
  assert.equal(repeated.id, imported.id, 'Import on either device updates the same account playlist')
  assert.equal((await desktop.tracks(imported.id)).length, 2, 'Reimport retains manual additions and does not duplicate account songs')
  const accountAudio = await client.resolve(remote[0].meta.service.track, '128k')
  assert.equal((await fetch(client.resourceUrl(accountAudio.url), { headers: { Range: 'bytes=0-127' } })).status, 206, 'Imported account music plays through Docker platform fallback')
})
