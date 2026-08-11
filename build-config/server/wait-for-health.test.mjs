import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'

import { waitForHealth } from './wait-for-health.mjs'

test('waitForHealth tolerates connection failures until the service becomes ready', async() => {
  const server = http.createServer((_request, response) => {
    response.writeHead(200).end('{"ok":true}')
  })
  const reserved = http.createServer()
  await new Promise((resolve, reject) => {
    reserved.once('error', reject)
    reserved.listen(0, '127.0.0.1', resolve)
  })
  const address = reserved.address()
  assert.notEqual(typeof address, 'string')
  assert.notEqual(address, null)
  const port = address.port
  await new Promise((resolve, reject) => reserved.close(error => error == null ? resolve() : reject(error)))

  setTimeout(() => server.listen(port, '127.0.0.1'), 150)
  try {
    await waitForHealth(`http://127.0.0.1:${port}`, { timeoutMs: 2_000, intervalMs: 25 })
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})
