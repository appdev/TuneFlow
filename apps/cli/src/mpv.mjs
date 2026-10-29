import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { fail, sleep } from './common.mjs'

export class Mpv extends EventEmitter {
  nextId = 0
  pending = new Map()
  async start() {
    if (this.socket && !this.socket.destroyed) return
    const child = this.child = spawn(process.env.TUNEFLOW_MPV || 'mpv', [
      '--no-config', '--load-scripts=no', '--idle=yes', '--no-terminal', '--no-video', '--input-terminal=no',
      // Closing this inherited duplex pipe also makes mpv quit if the daemon
      // crashes. No stream URL is placed in argv or persisted to disk.
      '--keep-open=no', '--input-ipc-client=fd://3',
    ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe'] })
    child.on('exit', () => {
      if (this.child !== child) return
      this.child = null
      this.disconnect()
      this.emit('player-exit')
    })
    const socket = this.socket = child.stdio[3]
    if (socket) {
      socket.setEncoding('utf8')
      let buffer = ''
      socket.on('data', chunk => {
        buffer += chunk
        if (buffer.length > 1024 * 1024) { socket.destroy(); return }
        let end
        while ((end = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, end)
          buffer = buffer.slice(end + 1)
          try {
            const value = JSON.parse(line)
            if (value.request_id) {
              const pending = this.pending.get(value.request_id)
              if (pending) {
                clearTimeout(pending.timer)
                this.pending.delete(value.request_id)
                if (value.error === 'success') pending.resolve(value.data)
                else pending.reject(fail('PLAYER_COMMAND_FAILED', 'The player rejected the command.'))
              }
            } else if (value.event) this.emit('event', value)
          } catch { /* Ignore malformed player events. */ }
        }
      })
      const disconnect = () => { if (this.socket === socket) this.disconnect() }
      socket.on('error', disconnect)
      socket.on('close', disconnect)
    }
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve)
      child.once('error', error => {
        this.disconnect()
        reject(fail(error.code === 'ENOENT' ? 'PLAYER_UNAVAILABLE' : 'PLAYER_START_FAILED', 'Install mpv or set TUNEFLOW_MPV to its executable.'))
      })
    })
    try { await this.command(['get_property', 'mpv-version']) } catch {
      await this.close()
      throw fail('PLAYER_START_FAILED', 'mpv did not initialize its JSON IPC interface.')
    }
  }
  disconnect() {
    this.socket?.destroy()
    this.socket = null
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(fail('PLAYER_DISCONNECTED')) }
    this.pending.clear()
  }
  command(command) {
    if (!this.socket || this.socket.destroyed) return Promise.reject(fail('PLAYER_NOT_RUNNING'))
    return new Promise((resolve, reject) => {
      const id = ++this.nextId
      const timer = setTimeout(() => { this.pending.delete(id); reject(fail('PLAYER_TIMEOUT')) }, 5000)
      this.pending.set(id, { resolve, reject, timer })
      this.socket.write(JSON.stringify({ command, request_id: id }) + '\n')
    })
  }
  async property(name) {
    try { return await this.command(['get_property', name]) } catch (error) {
      if (error.code === 'PLAYER_COMMAND_FAILED') return null
      throw error
    }
  }
  async close() {
    const child = this.child
    this.child = null
    this.disconnect()
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill()
      await Promise.race([new Promise(resolve => child.once('exit', resolve)), sleep(1000)])
      if (child.exitCode === null) child.kill('SIGKILL')
    }
  }
}
