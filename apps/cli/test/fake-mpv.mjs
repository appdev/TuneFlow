#!/usr/bin/env node
// Protocol fixture only: never used as a production player.
import net from 'node:net'
import { writeFileSync } from 'node:fs'
if (process.env.TUNEFLOW_FAKE_PID_FILE) writeFileSync(process.env.TUNEFLOW_FAKE_PID_FILE, String(process.pid))
let idle = true
let pause = false
let position = 0
let last = Date.now()
let volume = 60
let endTimer
let unknownDuration = false
const connections = new Set()
function connect(socket) {
  connections.add(socket)
  socket.on('error', () => {})
  socket.on('close', () => connections.delete(socket))
  let buffer = ''
  socket.on('data', chunk => {
    buffer += chunk
    let end
    while ((end = buffer.indexOf('\n')) >= 0) {
      const { request_id, command: [command, ...args] } = JSON.parse(buffer.slice(0, end))
      buffer = buffer.slice(end + 1)
      const now = Date.now()
      if (!idle && !pause) position += (now - last) / 1000
      last = now
      let data = null
      if (command === 'loadfile') {
        clearTimeout(endTimer)
        idle = false; pause = false; position = 0
        unknownDuration = args[0].endsWith('/unknown')
        if (args[0].endsWith('/finish')) endTimer = setTimeout(() => {
          idle = true
          for (const value of connections) value.write(JSON.stringify({ event: 'end-file', reason: 'eof' }) + '\n')
        }, 150)
      } else if (command === 'stop') { idle = true; position = 0; clearTimeout(endTimer) }
      else if (command === 'seek') position = args[1].startsWith('relative') ? Math.max(0, position + args[0]) : args[0]
      else if (command === 'set_property') {
        if (args[0] === 'pause') pause = args[1]
        if (args[0] === 'volume') volume = args[1]
      } else if (command === 'get_property') data = ({ 'mpv-version': 'fixture', 'time-pos': idle ? null : position, duration: idle || unknownDuration ? null : 269, pause, 'idle-active': idle, volume })[args[0]] ?? null
      socket.write(JSON.stringify({ request_id, error: 'success', data }) + '\n')
    }
  })
  socket.on('end', () => { clearTimeout(endTimer); socket.destroy() })
}
connect(new net.Socket({ fd: 3, readable: true, writable: true }))
process.on('SIGTERM', () => {
  clearTimeout(endTimer)
  for (const socket of connections) socket.destroy()
})
