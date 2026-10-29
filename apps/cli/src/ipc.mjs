import net from 'node:net'
import { spawn } from 'node:child_process'
import { open, readFile, unlink, lstat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { daemonSocket, runtime, fail, sleep } from './common.mjs'

export function rpc(socketPath, value, timeout = 120_000, signal) {
  if (signal?.aborted) return Promise.reject(fail('CANCELLED'))
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath)
    socket.setEncoding('utf8')
    let buffer = ''
    let settled = false
    const abort = () => done(fail('CANCELLED'))
    const timer = setTimeout(() => done(fail('IPC_TIMEOUT')), timeout)
    function done(error, result) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      socket.destroy()
      if (error) reject(error)
      else resolve(result)
    }
    socket.on('error', error => done(error))
    socket.on('connect', () => socket.write(JSON.stringify(value) + '\n'))
    socket.on('data', chunk => {
      buffer += chunk
      if (buffer.length > 1024 * 1024) return done(fail('INVALID_IPC_RESPONSE'))
      const end = buffer.indexOf('\n')
      if (end < 0) return
      try {
        const result = JSON.parse(buffer.slice(0, end))
        if (!result.ok) done(fail(result.error.code, result.error.message))
        else done(null, result.data)
      } catch { done(fail('INVALID_IPC_RESPONSE')) }
    })
    socket.on('end', () => done(fail('IPC_DISCONNECTED')))
    signal?.addEventListener('abort', abort, { once: true })
  })
}
export const offline = error => ['ENOENT', 'ECONNREFUSED', 'ECONNRESET', 'IPC_DISCONNECTED'].includes(error.code)
export const stopped = () => ({ state: 'stopped', track: null, positionMs: null, durationMs: null, progress: null, volume: null, queue: [], queueIndex: null })
export async function callDaemon(command, args = {}, start = false, signal) {
  try { return await rpc(daemonSocket, { command, args }, 120_000, signal) } catch (error) {
    if (!offline(error)) throw error
    if (!start) {
      if (command === 'status' || command === 'shutdown' || command === 'stop') return stopped()
      throw fail('PLAYER_NOT_RUNNING', 'Start playback first.')
    }
  }
  const lockPath = path.join(runtime, 'startup.lock')
  let lock
  for (let attempt = 0; attempt < 100; attempt++) {
    if (signal?.aborted) throw fail('CANCELLED')
    try {
      lock = await open(lockPath, 'wx', 0o600)
      await lock.writeFile(String(process.pid))
      break
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      const owner = Number(await readFile(lockPath, 'utf8').catch(() => '0'))
      if (owner > 0) {
        try { process.kill(owner, 0) } catch (error) { if (error.code === 'ESRCH') await unlink(lockPath).catch(() => {}) }
      }
      await sleep(100)
    }
  }
  if (!lock) throw fail('PLAYER_START_TIMEOUT')
  try {
    try { await rpc(daemonSocket, { command: 'status', args: {} }, 1000, signal) } catch (error) {
      if (!offline(error)) throw error
      // Remove only an unreachable socket while holding the startup lock.
      const stat = await lstat(daemonSocket).catch(() => null)
      if (stat && !stat.isSocket()) throw fail('INVALID_RUNTIME_PATH')
      if (stat) await unlink(daemonSocket)
      const child = spawn(process.execPath, [fileURLToPath(new URL('./daemon.mjs', import.meta.url))], { detached: true, stdio: 'ignore', env: process.env })
      let spawnError
      child.once('error', () => { spawnError = true })
      child.unref()
      let ready = false
      for (let attempt = 0; attempt < 100; attempt++) {
        if (spawnError || child.exitCode !== null) break
        try { await rpc(daemonSocket, { command: 'status', args: {} }, 1000, signal); ready = true; break } catch (error) { if (!offline(error)) throw error }
        await sleep(50)
      }
      if (!ready) throw fail('PLAYER_START_FAILED', 'Could not start the local playback daemon.')
    }
    return await rpc(daemonSocket, { command, args }, 120_000, signal)
  } finally {
    await lock.close()
    await unlink(lockPath).catch(() => {})
  }
}
