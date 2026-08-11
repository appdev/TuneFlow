import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'

import { activateSource, requestLyric } from './isolated-api.mjs'

test('activateSource uses the current Service activation contract', async() => {
  let received
  const server = http.createServer(async(request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    received = { method: request.method, url: request.url, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ data: { active: true } }))
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  assert.notEqual(typeof address, 'string')
  assert.notEqual(address, null)

  try {
    await activateSource(`http://127.0.0.1:${address.port}`, 'source/fixture')
    assert.deepEqual(received, {
      method: 'PUT',
      url: '/api/v1/sources/active',
      body: { sourceId: 'source/fixture' },
    })
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})

test('requestLyric uses the current catalog contract', async() => {
  let received
  const server = http.createServer(async(request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    received = { method: request.method, url: request.url, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ data: { lyric: 'fixture' } }))
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  assert.notEqual(typeof address, 'string')
  assert.notEqual(address, null)

  try {
    assert.equal(await requestLyric(`http://127.0.0.1:${address.port}`, 'fixture', { songmid: '1' }), 'fixture')
    assert.deepEqual(received, {
      method: 'POST',
      url: '/api/v1/catalog/tracks/lyrics',
      body: { source: 'fixture', musicInfo: { songmid: '1' } },
    })
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})
