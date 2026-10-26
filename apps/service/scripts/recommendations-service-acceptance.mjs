import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createWriteStream, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'

const root = mkdtempSync(path.join(os.tmpdir(), 'tuneflow-recommendations-acceptance-'))
const storageRoot = path.join(root, 'storage')
const logPath = path.join(root, 'service.log')
const evidencePath = path.join(root, 'evidence.json')
mkdirSync(storageRoot, { recursive: true })

const listen = async(server) => await new Promise((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    server.off('error', reject)
    resolve(server.address().port)
  })
})

const closeServer = async(server) => {
  if (server?.listening) await new Promise(resolve => server.close(resolve))
}

const reservePort = async() => {
  const server = net.createServer()
  const port = await listen(server)
  await closeServer(server)
  return port
}

const delay = async(ms) => await new Promise(resolve => setTimeout(resolve, ms))

const waitFor = async(work, description, timeoutMs = 20_000) => {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      const value = await work()
      if (value != null && value !== false) return value
    } catch (error) {
      lastError = error
    }
    await delay(100)
  }
  throw new Error(`Timed out waiting for ${description}${lastError == null ? '' : `: ${lastError.message}`}`)
}

const jsonRequest = async(origin, pathname, init) => {
  const response = await fetch(`${origin}${pathname}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  })
  const body = await response.json()
  if (!response.ok) throw new Error(`${init?.method ?? 'GET'} ${pathname} returned ${response.status}: ${JSON.stringify(body)}`)
  return { status: response.status, data: body.data }
}

const playlistTracks = Array.from({ length: 80 }, (_, index) => ({
  id: `fixture-${String(index + 1).padStart(3, '0')}`,
  name: `Acceptance track ${String(index + 1).padStart(3, '0')}`,
  artist: `Acceptance artist ${String(index + 1).padStart(3, '0')}`,
  album: `Acceptance album ${String(index + 1).padStart(3, '0')}`,
  albumid: `album-${index + 1}`,
  duration: '180',
  N_MINFO: 'level:128k,bitrate:128,format:mp3,size:3m',
}))

const providerResponses = {
  tags: JSON.stringify({
    code: 200,
    data: [{ id: 'group-1', name: 'Acceptance group', data: [{ id: '42', name: 'Acceptance tag', digest: '10000' }] }],
  }),
  hotTags: JSON.stringify({
    code: 200,
    data: [{ data: [{ id: '42', name: 'Acceptance tag', digest: '10000' }] }],
  }),
  browse: JSON.stringify({
    code: 200,
    data: {
      data: [{ id: '9001', digest: '8', name: 'Acceptance playlist', uname: 'Fixture', total: 80, listencnt: 1, favorcnt: 10, desc: 'deterministic', img: '' }],
      total: 1,
      pn: 1,
      rn: 36,
    },
  }),
  detail: JSON.stringify({
    result: 'ok',
    rn: 1000,
    total: playlistTracks.length,
    title: 'Acceptance playlist',
    pic: '',
    info: 'deterministic',
    uname: 'Fixture',
    playnum: 1,
    musiclist: playlistTracks,
  }),
}

const proxyRequests = []
const providerProxy = http.createServer((_request, response) => {
  response.statusCode = 502
  response.end('proxy requires CONNECT')
})
providerProxy.on('connect', (request, socket) => {
  proxyRequests.push(`CONNECT ${request.url}`)
  if (request.url?.startsWith('wbd.kuwo.cn:')) {
    socket.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n')
    return
  }
  socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
  socket.once('data', chunk => {
    if (chunk[0] === 0x16) {
      proxyRequests.push('TLS tunneled request')
      socket.destroy()
      return
    }
    const line = chunk.toString('utf8').split('\r\n', 1)[0]
    proxyRequests.push(line)
    let body
    if (line.includes('getTagList')) body = providerResponses.tags
    else if (line.includes('getRcmTagList')) body = providerResponses.hotTags
    else if (line.includes('getTagPlayList')) body = providerResponses.browse
    else if (line.includes('/pl.svc?')) body = providerResponses.detail
    else {
      socket.end('HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n')
      return
    }
    socket.end(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`)
  })
})

const audioRequests = []
const audioBody = Buffer.from('ID3\u0004\u0000\u0000\u0000\u0000\u0000\u0000')
const audioServer = http.createServer((request, response) => {
  audioRequests.push(`${request.method} ${request.url}`)
  response.writeHead(200, {
    'accept-ranges': 'bytes',
    'content-length': audioBody.length,
    'content-type': 'audio/mpeg',
  })
  if (request.method === 'HEAD') response.end()
  else response.end(audioBody)
})

let service
let logStream
const serviceRuns = []

const stopService = async() => {
  if (service == null || service.exitCode != null) return
  service.kill('SIGTERM')
  await new Promise(resolve => service.once('exit', resolve))
  service = undefined
  if (logStream != null) await new Promise(resolve => logStream.end(resolve))
  logStream = undefined
}

const startService = async(servicePort, proxyPort) => {
  logStream = createWriteStream(logPath, { flags: serviceRuns.length === 0 ? 'w' : 'a' })
  logStream.write(`\n=== service run ${serviceRuns.length + 1} ===\n`)
  service = spawn(process.execPath, ['dist/server/index.cjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      TUNEFLOW_TEST_ALLOW_PRIVATE_PLAYBACK_TARGETS: '1',
      TUNEFLOW_TEST_ALLOW_PRIVATE_SOURCE_TARGETS: '1',
      HTTP_PROXY: `http://127.0.0.1:${proxyPort}`,
      HTTPS_PROXY: `http://127.0.0.1:${proxyPort}`,
      TUNEFLOW_HOST: '127.0.0.1',
      TUNEFLOW_PORT: String(servicePort),
      TUNEFLOW_STORAGE_ROOT: storageRoot,
      TUNEFLOW_WEB_ROOT: path.join(process.cwd(), 'dist/web'),
      TUNEFLOW_SERVICE_NODE_MODULES: path.join(process.cwd(), 'dist/server/node_modules'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  service.stdout.pipe(logStream, { end: false })
  service.stderr.pipe(logStream, { end: false })
  const origin = `http://127.0.0.1:${servicePort}`
  await waitFor(async() => {
    const response = await fetch(`${origin}/api/v1/health`)
    return response.status === 200
  }, 'Service health', 20_000)
  serviceRuns.push({ pid: service.pid, port: servicePort })
  return origin
}

const subscribe = origin => {
  const events = []
  const request = http.get(`${origin}/api/v1/events`, response => {
    response.setEncoding('utf8')
    let buffered = ''
    response.on('data', chunk => {
      buffered += chunk
      const messages = buffered.split('\n\n')
      buffered = messages.pop() ?? ''
      for (const message of messages) {
        const event = /^event: (.+)$/m.exec(message)?.[1]
        const data = /^data: (.+)$/m.exec(message)?.[1]
        if (event != null && data != null) events.push({ event, payload: JSON.parse(data) })
      }
    })
  })
  return { events, close: () => request.destroy() }
}

let exitCode = 1
try {
  const proxyPort = await listen(providerProxy)
  const audioPort = await listen(audioServer)
  const servicePort = await reservePort()
  const origin = await startService(servicePort, proxyPort)
  const sse = subscribe(origin)
  await waitFor(() => sse.events.length >= 0, 'SSE connection')

  const sourceScript = `/*
 * @name Recommendation process acceptance
 * @description Deterministic music URL source
 * @version 1.0.0
 */
window.tuneflow.on(window.tuneflow.EVENT_NAMES.request, async ({ source, action }) => {
  if (source !== 'kw' || action !== 'musicUrl') throw new Error('unexpected request')
  return 'http://127.0.0.1:${audioPort}/fixture.mp3'
})
window.tuneflow.send(window.tuneflow.EVENT_NAMES.inited, {
  sources: { kw: { type: 'music', actions: ['musicUrl'], qualitys: ['128k'] } },
})`
  const installed = await jsonRequest(origin, '/api/v1/sources', {
    method: 'POST', body: JSON.stringify({ script: sourceScript }),
  })
  await jsonRequest(origin, '/api/v1/sources/active', {
    method: 'PUT', body: JSON.stringify({ sourceId: installed.data.id }),
  })

  const warming = await jsonRequest(origin, '/api/v1/recommendations/daily')
  assert.equal(warming.data.status, 'warming')
  const first = await waitFor(async() => {
    const result = await jsonRequest(origin, '/api/v1/recommendations/daily')
    return result.data.version === 1 ? result.data : null
  }, 'first recommendation snapshot', 30_000)
  assert.equal(first.status, 'degraded')
  assert.deepEqual(first.sourceCoverage, ['kw'])
  assert.equal(first.items.length, 30)
  assert.equal(new Set(first.items.map(item => item.canonicalTrackId)).size, 30)
  const stable = (await jsonRequest(origin, '/api/v1/recommendations/daily')).data
  assert.deepEqual(stable, first)
  const firstStatus = (await jsonRequest(origin, '/api/v1/recommendations/status')).data
  assert.match(firstStatus.lastErrorCode, /^kw:/)

  const refresh = await jsonRequest(origin, '/api/v1/recommendations/daily/refresh', { method: 'POST', body: '{}' })
  assert.equal(refresh.status, 202)
  const second = await waitFor(async() => {
    const result = await jsonRequest(origin, '/api/v1/recommendations/daily')
    return result.data.version === 2 ? result.data : null
  }, 'replacement recommendation snapshot', 30_000)
  assert.equal(second.items.length, 30)
  assert.equal(second.status, 'degraded')
  assert.equal(second.items.some(item => first.items.some(previous => previous.canonicalTrackId === item.canonicalTrackId)), false)
  await waitFor(() => sse.events.filter(event => event.event === 'recommendations.updated').length >= 2, 'recommendation SSE updates')

  await jsonRequest(origin, '/api/v1/recommendations/daily/refresh', { method: 'POST', body: '{}' })
  const third = await waitFor(async() => {
    const result = await jsonRequest(origin, '/api/v1/recommendations/daily')
    return result.data.version === 3 ? result.data : null
  }, 'third recommendation snapshot', 30_000)
  assert.equal(third.items.length, 20)
  const allExposed = new Set([...first.items, ...second.items, ...third.items].map(item => item.canonicalTrackId))
  assert.equal(allExposed.size, 80)
  await jsonRequest(origin, '/api/v1/recommendations/daily/refresh', { method: 'POST', body: '{}' })
  const failedRefreshStatus = await waitFor(async() => {
    const result = (await jsonRequest(origin, '/api/v1/recommendations/status')).data
    return result.status !== 'generating' && result.lastErrorCode === 'INSUFFICIENT_RECOMMENDATION_CANDIDATES' ? result : null
  }, 'failed refresh status', 30_000)
  const retainedAfterFailure = (await jsonRequest(origin, '/api/v1/recommendations/daily')).data
  assert.deepEqual(retainedAfterFailure, third)

  const completedItem = second.items[0]
  const earlyItem = second.items[1]
  const resolved = await jsonRequest(origin, '/api/v1/playback/tracks/resolve', {
    method: 'POST',
    body: JSON.stringify({ source: 'kw', quality: '128k', info: completedItem.track, recommendationItemId: completedItem.recommendationItemId }),
  })
  assert.match(resolved.data.url, /^\/api\/v1\/streams\//)
  const streamHead = await fetch(`${origin}${resolved.data.url}`, { method: 'HEAD' })
  assert.equal(streamHead.status, 200)

  const startPlayback = async(item) => (await jsonRequest(origin, '/api/v1/playback/history', {
    method: 'POST', body: JSON.stringify({ track: item.track, platform: 'web', recommendationItemId: item.recommendationItemId }),
  })).data
  const finishPlayback = async(session, terminal) => (await jsonRequest(origin, `/api/v1/playback/history/${session.playbackId}`, {
    method: 'PATCH', body: JSON.stringify(terminal),
  })).data
  const completedSession = await startPlayback(completedItem)
  const completedTerminal = { completed: true, lastPositionSeconds: 180, durationSeconds: 180 }
  await finishPlayback(completedSession, completedTerminal)
  await finishPlayback(completedSession, completedTerminal)
  const earlySession = await startPlayback(earlyItem)
  const earlyTerminal = { completed: false, lastPositionSeconds: 29, durationSeconds: 180 }
  await finishPlayback(earlySession, earlyTerminal)
  await finishPlayback(earlySession, earlyTerminal)
  await waitFor(async() => {
    const history = (await jsonRequest(origin, '/api/v1/playback/history')).data
    return history.filter(item => item.endedAt != null).length >= 2
  }, 'terminal playback history')

  sse.close()
  await stopService()

  const databasePath = path.join(storageRoot, 'tuneflow.data.db')
  const database = new Database(databasePath, { readonly: true })
  const databaseEvidence = {
    snapshots: database.prepare('SELECT local_date AS localDate, version, status, source_coverage_json AS sourceCoverage FROM recommendation_snapshot ORDER BY version').all(),
    current: database.prepare('SELECT local_date AS localDate, snapshot_id AS snapshotId FROM recommendation_current_snapshot').all(),
    playlist: database.prepare('SELECT source, playlist_id AS playlistId, sampled_at AS sampledAt FROM recommendation_catalog_playlist').all(),
    catalogTracks: database.prepare('SELECT COUNT(*) AS count FROM recommendation_catalog_track').get(),
    effects: database.prepare(`SELECT recommendation_item_id AS recommendationItemId, resolve_outcome AS resolveOutcome,
      playback_started_count AS started, playback_completed_count AS completed,
      playback_accepted_count AS accepted, playback_early_skip_count AS earlySkip
      FROM recommendation_snapshot_item WHERE recommendation_item_id IN (?, ?) ORDER BY recommendation_item_id`).all(completedItem.recommendationItemId, earlyItem.recommendationItemId),
    playbackEffects: database.prepare('SELECT playback_id AS playbackId, completed, accepted, early_skip AS earlySkip FROM recommendation_playback_effect ORDER BY started_at').all(),
    taste: database.prepare('SELECT score, play_count AS playCount, completed_count AS completedCount, early_skip_count AS earlySkipCount FROM recommendation_taste_track ORDER BY score DESC').all(),
    history: database.prepare('SELECT playback_id AS playbackId, completed, recommendation_item_id AS recommendationItemId FROM web_playback_history ORDER BY sequence').all(),
    jobs: database.prepare('SELECT status, error_code AS errorCode FROM recommendation_job ORDER BY started_at').all(),
  }
  database.close()
  assert.equal(databaseEvidence.snapshots.length, 3)
  assert.equal(databaseEvidence.playlist.length, 1)
  assert.equal(databaseEvidence.catalogTracks.count, 80)
  assert.equal(databaseEvidence.playbackEffects.length, 2)
  assert.equal(databaseEvidence.history.length, 2)
  assert.deepEqual(databaseEvidence.effects.map(item => [item.started, item.completed, item.accepted, item.earlySkip]).sort(), [[1, 0, 0, 1], [1, 1, 1, 0]])
  assert.deepEqual(databaseEvidence.taste.map(item => [item.score, item.playCount, item.completedCount, item.earlySkipCount]).sort((left, right) => left[0] - right[0]), [[-1.5, 1, 0, 1], [1.5, 1, 1, 0]])

  const proxyRequestsBeforeRestart = proxyRequests.length
  const restartedOrigin = await startService(servicePort, proxyPort)
  const afterRestart = (await jsonRequest(restartedOrigin, '/api/v1/recommendations/daily')).data
  const historyAfterRestart = (await jsonRequest(restartedOrigin, '/api/v1/playback/history')).data
  assert.deepEqual(afterRestart, third)
  assert.equal(historyAfterRestart.length, 2)
  assert.equal(proxyRequests.length, proxyRequestsBeforeRestart)
  await stopService()

  const evidence = {
    root,
    command: 'node scripts/recommendations-service-acceptance.mjs',
    serviceRuns,
    warming: warming.data,
    first: { status: first.status, version: first.version, sourceCoverage: first.sourceCoverage, itemCount: first.items.length },
    stableReadMatched: true,
    refresh: refresh.data,
    second: { status: second.status, version: second.version, sourceCoverage: second.sourceCoverage, itemCount: second.items.length },
    third: { status: third.status, version: third.version, sourceCoverage: third.sourceCoverage, itemCount: third.items.length },
    sameDayOverlap: 0,
    status: firstStatus,
    failedRefresh: { status: failedRefreshStatus, retainedVersion: retainedAfterFailure.version, retainedItemCount: retainedAfterFailure.items.length },
    sseRecommendationEvents: sse.events.filter(event => event.event === 'recommendations.updated').map(event => ({ sequence: event.payload.sequence, version: event.payload.data.version, status: event.payload.data.status })),
    resolve: { status: resolved.status, url: resolved.data.url, streamHeadStatus: streamHead.status },
    audioRequests,
    proxyRequests,
    database: databaseEvidence,
    restart: { snapshotMatched: true, historyCount: historyAfterRestart.length, providerRequestsAdded: proxyRequests.length - proxyRequestsBeforeRestart },
    logPath,
  }
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`)
  console.log(JSON.stringify(evidence, null, 2))
  console.log(`Evidence: ${evidencePath}`)
  exitCode = 0
} finally {
  await stopService()
  await closeServer(audioServer)
  await closeServer(providerProxy)
  process.exitCode = exitCode
}
