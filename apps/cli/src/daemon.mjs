import net from 'node:net'
import { chmod, unlink } from 'node:fs/promises'
import { init, daemonSocket, getTrack, media, fail, errorValue } from './common.mjs'
import { stopped } from './ipc.mjs'
import { Mpv } from './mpv.mjs'

await init()
const player = new Mpv()
const lifetime = new AbortController()
let queue = []
let index = -1
let track = null
let phase = 'stopped'
let positionMs = null
let durationMs = null
let playbackError = null
let generation = 0
let chain = Promise.resolve()
let closing = false
const serialize = task => {
  const next = chain.then(task)
  chain = next.catch(() => {})
  return next
}
async function load(nextIndex, nextQueue = queue) {
  const next = nextQueue[nextIndex]
  if (!next) throw fail('QUEUE_BOUNDARY', 'No track in that direction.')
  const entry = await getTrack(next.ref, next.server)
  const url = await media(entry, next.quality, lifetime.signal)
  await player.start()
  await player.command(['set_property', 'pause', false])
  generation++
  queue = nextQueue
  index = nextIndex
  track = { ref: next.ref, id: entry.track.id, name: entry.track.name ?? '', singer: entry.track.singer ?? '', source: entry.track.source }
  phase = 'loading'
  playbackError = null
  positionMs = null
  durationMs = null
  try { await player.command(['loadfile', url, 'replace']) } catch (error) {
    phase = 'error'
    playbackError = errorValue(error)
    throw error
  }
}
const milliseconds = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value * 1000) : null
async function status() {
  let volume = null
  if (player.socket) {
    const [position, duration, paused, idle, level] = await Promise.all(['time-pos', 'duration', 'pause', 'idle-active', 'volume'].map(name => player.property(name)))
    if (typeof level === 'number' && Number.isFinite(level)) volume = level
    if (idle === false) {
      positionMs = milliseconds(position)
      durationMs = milliseconds(duration)
      phase = positionMs === null ? 'loading' : (paused ? 'paused' : 'playing')
    }
  }
  return {
    state: phase, track, positionMs, durationMs,
    progress: positionMs !== null && durationMs > 0 ? Math.min(1, Math.max(0, positionMs / durationMs)) : null,
    volume, queue: queue.map(item => item.ref), queueIndex: index >= 0 ? index : null,
    ...(playbackError ? { error: playbackError } : {}),
  }
}
player.on('event', event => {
  if (event.event !== 'end-file' || !['eof', 'error'].includes(event.reason)) return
  const observed = generation
  void serialize(async() => {
    if (generation !== observed || closing) return
    phase = event.reason === 'error' ? 'error' : 'ended'
    if (event.reason === 'error') { playbackError = { code: 'PLAYBACK_FAILED', message: 'The player could not read this track.' }; return }
    if (index + 1 < queue.length) {
      try { await load(index + 1) } catch (error) { phase = 'error'; playbackError = errorValue(error) }
    }
  })
})
player.on('player-exit', () => {
  if (!closing) { phase = 'error'; playbackError = { code: 'PLAYER_EXITED', message: 'The player exited unexpectedly.' } }
})

async function execute(command, args) {
  if (command === 'status') return status()
  if (command === 'play') {
    if (!Array.isArray(args.refs) || !args.refs.length || args.refs.length > 1000) throw fail('INVALID_ARGUMENT')
    for (const ref of args.refs) await getTrack(ref, args.server)
    const nextQueue = args.refs.map(ref => ({ ref, server: args.server, quality: args.quality }))
    await load(0, nextQueue)
  } else if (command === 'queue') {
    if (!Array.isArray(args.refs) || !args.refs.length || queue.length + args.refs.length > 1000) throw fail('INVALID_ARGUMENT')
    for (const ref of args.refs) await getTrack(ref, args.server)
    queue.push(...args.refs.map(ref => ({ ref, server: args.server, quality: args.quality })))
  } else if (command === 'next' || command === 'previous') {
    await load(index + (command === 'next' ? 1 : -1))
  } else if (command === 'pause' || command === 'resume') {
    if (!['playing', 'paused', 'loading'].includes(phase)) throw fail('NOT_PLAYING')
    await player.command(['set_property', 'pause', command === 'pause'])
  } else if (command === 'seek') {
    if (!['playing', 'paused', 'loading'].includes(phase)) throw fail('NOT_PLAYING')
    if (!Number.isFinite(args.seconds) || (!args.relative && args.seconds < 0)) throw fail('INVALID_ARGUMENT')
    await player.command(['seek', args.seconds, args.relative ? 'relative+exact' : 'absolute+exact'])
  } else if (command === 'volume') {
    if (!Number.isFinite(args.value) || args.value < 0 || args.value > 100) throw fail('INVALID_ARGUMENT')
    await player.command(['set_property', 'volume', args.value])
  } else if (command === 'stop') {
    generation++
    if (player.socket) await player.command(['stop'])
    phase = 'stopped'
    positionMs = null
    durationMs = null
    playbackError = null
  } else if (command === 'shutdown') {
    closing = true
    return stopped()
  } else throw fail('UNKNOWN_COMMAND')
  return status()
}

const connections = new Set()
const server = net.createServer(socket => {
  socket.setEncoding('utf8')
  connections.add(socket)
  socket.once('close', () => connections.delete(socket))
  socket.on('error', () => {})
  socket.setTimeout(125_000, () => socket.destroy())
  let buffer = ''
  let received = false
  socket.on('data', chunk => {
    if (received) return
    buffer += chunk
    if (buffer.length > 256 * 1024) { socket.destroy(); return }
    const end = buffer.indexOf('\n')
    if (end < 0) return
    received = true
    void serialize(async() => {
      let result
      try {
        const { command, args } = JSON.parse(buffer.slice(0, end))
        result = { ok: true, data: await execute(command, args ?? {}) }
      } catch (error) { result = { ok: false, error: errorValue(error) } }
      await new Promise(resolve => socket.end(JSON.stringify(result) + '\n', resolve))
      if (closing) await shutdown()
    })
  })
})
let bound = false
async function shutdown() {
  closing = true
  lifetime.abort()
  await player.close()
  for (const socket of connections) socket.destroy()
  server.close()
  if (bound) await unlink(daemonSocket).catch(() => {})
}
process.once('SIGTERM', () => { void shutdown() })
process.once('SIGINT', () => { void shutdown() })
server.on('error', () => { process.exitCode = 1; void shutdown() })
server.listen(daemonSocket, async() => { bound = true; await chmod(daemonSocket, 0o600) })
