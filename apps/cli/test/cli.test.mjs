import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { chmod, mkdtemp, readFile, readdir, rm, writeFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'
import { runtimeFor } from '../src/common.mjs'
import { rpc } from '../src/ipc.mjs'

const bin = fileURLToPath(new URL('../bin/tuneflow.mjs', import.meta.url))
const fake = fileURLToPath(new URL('./fake-mpv.mjs', import.meta.url))
await chmod(fake, 0o755)
const song = { id: 'a', source: 'kw', songmid: 'a', name: '晴天', singer: '周杰伦', interval: '04:29', meta: { songId: 'a' } }

function invoke(args, env) {
  const child = spawn(process.execPath, [bin, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  let err = ''
  child.stdout.on('data', value => { out += value })
  child.stderr.on('data', value => { err += value })
  return new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('close', code => {
      try { resolve({ code, lines: out.trim().split('\n').filter(Boolean).map(line => JSON.parse(line)), err }) } catch (error) { reject(error) }
    })
  })
}
async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'tfcli-test-'))
  const requests = []
  const server = http.createServer(async(req, res) => {
    let body = ''
    for await (const part of req) body += part
    const data = body ? JSON.parse(body) : undefined
    requests.push({ url: req.url, method: req.method, data })
    let value
    if (req.url === '/api/v1/health') value = { status: 'ok' }
    else if (req.url === '/api/v1/catalog/capabilities') value = { sources: [{ id: 'kw', name: '酷我', searchKinds: ['track'] }] }
    else if (req.url === '/api/v1/catalog/tracks/search') value = { list: ['unknown', 'broken', 'unsafe'].includes(data.text) ? [{ ...song, id: data.text }] : [song, { ...song, id: 'finish', songmid: 'finish' }], total: 2, page: data.page, limit: 30 }
    else if (req.url === '/api/v1/playback/tracks/resolve') value = { url: data.info.id === 'unsafe' ? 'https://invalid.example/audio' : `/api/v1/streams/${data.info.id}`, quality: data.quality, expiresAt: Date.now() + 60000 }
    else if (req.url === '/api/v1/library/tracks') value = [{ id: 'local-a', musicInfo: { ...song, id: 'local-a', source: 'local' }, streamUrl: '/api/v1/library/tracks/local-a/stream' }]
    else if (req.url === '/api/v1/playlists?includeBuiltIn=true') value = [{ id: 'default', name: 'list__name_default', source: 'local' }]
    else if (req.url === '/api/v1/playlists/default') value = { id: 'default', name: 'list__name_default', tracks: [song] }
    else if (req.url === '/api/v1/downloads') value = req.method === 'POST'
      ? { id: 'download-a', status: 'waiting', quality: data.quality, progress: 0 }
      : [{ id: 'download-a', status: 'completed', quality: '128k', progress: 1, musicInfo: song }]
    else if (req.url === '/api/v1/streams/broken') { res.write('partial'); setTimeout(() => res.destroy(), 20); return }
    else if (req.url.startsWith('/api/v1/streams/') || req.url.endsWith('/stream')) { res.end('fixture-audio'); return }
    else { res.writeHead(404).end(); return }
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ data: value }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const endpoint = `http://127.0.0.1:${server.address().port}`
  const env = { ...process.env, TUNEFLOW_CONFIG_DIR: directory, TUNEFLOW_SERVER: endpoint, TUNEFLOW_MPV: fake }
  const run = async(...args) => {
    const result = await invoke(args, env)
    assert.equal(result.err, '')
    return result
  }
  const ok = async(...args) => {
    const result = await run(...args)
    assert.equal(result.code, 0, JSON.stringify(result.lines))
    assert.equal(result.lines.length, 1)
    assert.equal(result.lines[0].ok, true)
    return result.lines[0].data
  }
  t.after(async() => {
    await run('shutdown')
    await sleep(100)
    await new Promise(resolve => server.close(resolve))
    await rm(directory, { recursive: true, force: true })
    await rm(runtimeFor(directory), { recursive: true, force: true })
  })
  return { directory, requests, server: endpoint, env, run, ok }
}

test('search refs survive processes and preserve the shared Service contract', async t => {
  const f = await fixture(t)
  assert.equal((await f.ok('status')).state, 'stopped')
  const search = await f.ok('search', '晴天', '--page', '2')
  assert.equal(search.list[0].name, song.name)
  assert.match(search.list[0].ref, /^[a-f0-9]{32}$/)
  assert.equal((await f.ok('search', '晴天')).list[0].ref, search.list[0].ref)
  assert.deepEqual(f.requests.find(req => req.url.endsWith('/search')).data, { source: 'kw', text: '晴天', page: 2, pageSize: 30 })
  const ref = search.list[0].ref
  assert.equal((await f.ok('play', ref)).state, 'playing')
  await sleep(60)
  const status = await f.ok('status', '--json')
  assert.equal(status.track.ref, ref)
  assert.ok(status.positionMs > 0)
  assert.equal(status.durationMs, 269000)
  assert.equal(status.progress, status.positionMs / status.durationMs)
  assert.deepEqual(f.requests.find(req => req.url.endsWith('/resolve')).data, { source: 'kw', info: song, quality: '128k', preferLocal: true })
  const paused = await f.ok('pause')
  await sleep(50)
  assert.equal((await f.ok('status')).positionMs, paused.positionMs)
  assert.equal((await f.ok('seek', '90')).positionMs, 90000)
  assert.equal((await f.ok('seek', '--by', '-15')).positionMs, 75000)
  assert.equal((await f.ok('volume', '45')).volume, 45)
  assert.equal((await f.ok('resume')).state, 'playing')
  assert.equal((await f.ok('stop')).state, 'stopped')
  for (const name of await readdir(path.join(f.directory, 'refs'))) {
    assert.ok(!(await readFile(path.join(f.directory, 'refs', name), 'utf8')).includes('/streams/'))
  }
})

test('queue navigation, automatic advancement and completion', async t => {
  const f = await fixture(t)
  const { list } = await f.ok('search', 'song')
  const [a, end] = list.map(track => track.ref)
  await f.ok('play', a)
  assert.deepEqual((await f.ok('queue', end)).queue, [a, end])
  assert.equal((await f.ok('next')).queueIndex, 1)
  await sleep(250)
  assert.equal((await f.ok('status')).state, 'ended')
  assert.equal((await f.ok('previous')).queueIndex, 0)
  await f.ok('play', end, a)
  await sleep(250)
  assert.equal((await f.ok('status')).track.ref, a)
})

test('JSONL progress supports bounded output and watcher cancellation leaves music playing', async t => {
  const f = await fixture(t)
  const ref = (await f.ok('search', 'song')).list[0].ref
  await f.ok('play', ref)
  const watched = await f.run('status', '--watch', '--interval', '100', '--count', '3')
  assert.equal(watched.code, 0)
  assert.equal(watched.lines.length, 3)
  assert.ok(watched.lines.every(line => line.ok && line.data.durationMs === 269000))
  assert.ok(watched.lines[2].data.positionMs > watched.lines[0].data.positionMs)
  const watcher = spawn(process.execPath, [bin, 'status', '--watch', '--interval', '100'], { env: f.env, stdio: ['ignore', 'pipe', 'pipe'] })
  const finished = new Promise(resolve => watcher.on('close', resolve))
  await new Promise(resolve => watcher.stdout.once('data', resolve))
  watcher.kill('SIGINT')
  assert.equal(await finished, 130)
  assert.equal((await f.ok('status')).state, 'playing')
})

test('downloads, music library, playlists and non-destructive local export', async t => {
  const f = await fixture(t)
  const ref = (await f.ok('search', 'song')).list[0].ref
  assert.equal((await f.ok('download', ref)).id, 'download-a')
  assert.equal(f.requests.find(req => req.method === 'POST' && req.url === '/api/v1/downloads').data.existingFilePolicy, 'error')
  await f.ok('download', ref, '--replace')
  assert.equal(f.requests.filter(req => req.method === 'POST' && req.url === '/api/v1/downloads').at(-1).data.existingFilePolicy, 'replace')
  assert.equal((await f.ok('downloads')).list[0].status, 'completed')
  const local = (await f.ok('library')).list[0]
  assert.equal((await f.ok('play', local.ref)).track.source, 'local')
  assert.equal((await f.ok('playlists')).list[0].name, '默认列表')
  assert.equal((await f.ok('playlists', 'default')).tracks[0].ref, ref)
  const output = path.join(f.directory, '晴天.mp3')
  await f.ok('download', local.ref, '--output', output)
  assert.equal(await readFile(output, 'utf8'), 'fixture-audio')
  await writeFile(output, 'keep me')
  assert.equal((await f.run('download', ref, '--output', output)).lines[0].error.code, 'FILE_EXISTS')
  assert.equal(await readFile(output, 'utf8'), 'keep me')
  await f.ok('download', ref, '--output', output, '--replace')
  assert.equal(await readFile(output, 'utf8'), 'fixture-audio')
  assert.equal((await readdir(f.directory)).filter(name => name.endsWith('.part')).length, 0)
})

test('invalid inputs, endpoint isolation and unavailable player produce JSON errors', async t => {
  const f = await fixture(t)
  for (const args of [['search'], ['search', 'x', '--page', 'NaN'], ['status', '--interval', '100'], ['status', '--watch', '--interval', '0'], ['seek', '1', '--by', '2'], ['volume', '101'], ['play', '../../bad'], ['search', 'x', '--wat'], ['download', 'x', '--watch']]) {
    const result = await f.run(...args)
    assert.equal(result.code, 1)
    assert.equal(result.lines[0].ok, false)
  }
  const ref = (await f.ok('search', 'song')).list[0].ref
  assert.equal((await f.run('play', ref, '--server', 'http://localhost:1')).lines[0].error.code, 'REF_SERVER_MISMATCH')
  f.env.TUNEFLOW_MPV = path.join(f.directory, 'missing-player')
  assert.equal((await f.run('play', ref)).lines[0].error.code, 'PLAYER_UNAVAILABLE')
  assert.equal((await f.run('pause')).lines[0].error.code, 'NOT_PLAYING')
})

test('configuration persists only a validated Service address', async t => {
  const f = await fixture(t)
  await f.ok('configure', '--server', f.server)
  assert.deepEqual(JSON.parse(await readFile(path.join(f.directory, 'config.json'), 'utf8')), { server: f.server })
  assert.equal((await stat(path.join(f.directory, 'config.json'))).mode & 0o777, 0o600)
  delete f.env.TUNEFLOW_SERVER
  assert.equal((await f.ok('search', 'song')).server, f.server)
  assert.equal((await f.run('configure', '--server', 'http://user:password@localhost')).lines[0].error.code, 'INVALID_SERVER_ADDRESS')
})

test('unknown duration stays null and unsafe resource URLs are rejected', async t => {
  const f = await fixture(t)
  const ref = (await f.ok('search', 'unknown')).list[0].ref
  const playing = await f.ok('play', ref)
  assert.equal(playing.state, 'playing')
  assert.equal(playing.durationMs, null)
  assert.equal(playing.progress, null)
  const unsafe = (await f.ok('search', 'unsafe')).list[0].ref
  assert.equal((await f.run('play', unsafe)).lines[0].error.code, 'INVALID_RESOURCE_URL')
  assert.equal((await f.ok('status')).track.ref, ref)
})

test('failed local export preserves existing audio and removes partial files', async t => {
  const f = await fixture(t)
  const ref = (await f.ok('search', 'broken')).list[0].ref
  const output = path.join(f.directory, 'existing.mp3')
  await writeFile(output, 'original-audio')
  const result = await f.run('download', ref, '--output', output, '--replace')
  assert.equal(result.code, 1)
  assert.equal(await readFile(output, 'utf8'), 'original-audio')
  assert.ok(!(await readdir(f.directory)).some(name => name.endsWith('.part')))
})

test('simultaneous first playback calls share one daemon', async t => {
  const f = await fixture(t)
  const ref = (await f.ok('search', 'song')).list[0].ref
  await Promise.all([f.ok('play', ref), f.ok('play', ref)])
  assert.deepEqual((await f.ok('status')).queue, [ref])
  await f.ok('shutdown')
  assert.equal((await f.ok('status')).state, 'stopped')
})

test('daemon crash closes inherited player IPC and next play recovers the stale socket', async t => {
  const f = await fixture(t)
  const ref = (await f.ok('search', 'song')).list[0].ref
  f.env.TUNEFLOW_FAKE_PID_FILE = path.join(f.directory, 'player.pid')
  const daemon = spawn(process.execPath, [fileURLToPath(new URL('../src/daemon.mjs', import.meta.url))], { env: f.env, stdio: 'ignore' })
  const closed = new Promise(resolve => daemon.once('close', resolve))
  t.after(() => { if (daemon.exitCode === null && daemon.signalCode === null) daemon.kill() })
  const socket = path.join(runtimeFor(f.directory), 'daemon.sock')
  let ready = false
  for (let i = 0; i < 100; i++) {
    try { await rpc(socket, { command: 'status' }, 1000); ready = true; break } catch { await sleep(20) }
  }
  assert.equal(ready, true)
  await f.ok('play', ref)
  const playerPid = Number(await readFile(f.env.TUNEFLOW_FAKE_PID_FILE, 'utf8'))
  daemon.kill('SIGKILL')
  await closed
  let exited = false
  for (let i = 0; i < 100; i++) {
    try { process.kill(playerPid, 0) } catch (error) { if (error.code === 'ESRCH') { exited = true; break } }
    await sleep(20)
  }
  assert.equal(exited, true, 'Player must exit when its parent IPC closes')
  assert.equal((await f.ok('play', ref)).state, 'playing')
})

test('IPC preserves split UTF-8 characters and cancellation interrupts pending requests', async t => {
  const f = await fixture(t)
  await f.ok('status')
  const socketPath = path.join(runtimeFor(f.directory), 'test.sock')
  const server = net.createServer(socket => {
    socket.on('error', () => {})
    socket.once('data', chunk => {
      if (JSON.parse(chunk).command === 'wait') return
      const bytes = Buffer.from(JSON.stringify({ ok: true, data: { name: '晴天' } }) + '\n')
      const split = bytes.indexOf(Buffer.from('晴')) + 1
      socket.write(bytes.subarray(0, split))
      setTimeout(() => socket.end(bytes.subarray(split)), 10)
    })
  })
  await new Promise(resolve => server.listen(socketPath, resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  assert.deepEqual(await rpc(socketPath, { command: 'text' }), { name: '晴天' })
  const controller = new AbortController()
  const pending = rpc(socketPath, { command: 'wait' }, 10000, controller.signal)
  setTimeout(() => controller.abort(), 20)
  await assert.rejects(pending, { code: 'CANCELLED' })
})

test('closed stdout exits without leaking a stack trace', async() => {
  const child = spawn(process.execPath, [bin, '--help'], { stdio: ['ignore', 'pipe', 'pipe'] })
  let stderr = ''
  child.stderr.on('data', chunk => { stderr += chunk })
  child.stdout.destroy()
  const code = await new Promise(resolve => child.once('close', resolve))
  assert.equal(code, 0)
  assert.equal(stderr, '')
})
