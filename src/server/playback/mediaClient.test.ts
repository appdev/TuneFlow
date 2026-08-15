import { createServer } from 'node:http'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { MediaClient } from './mediaClient'

const servers: Array<ReturnType<typeof createServer>> = []
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z9aQAAAAASUVORK5CYII=', 'base64')

const startFixture = async(): Promise<string> => {
  const server = createServer((request, response) => {
    if (request.url === '/audio') {
      const range = request.headers.range
      if (range !== 'bytes=0-65535') {
        response.writeHead(400).end()
        return
      }
      response.writeHead(206, {
        'content-type': 'audio/mpeg',
        'content-length': 4,
        'content-range': 'bytes 0-3/4',
      }).end(Buffer.from([0x49, 0x44, 0x33, 0]))
      return
    }
    if (request.url === '/ignored-range') {
      response.writeHead(200, { 'content-type': 'audio/mpeg' }).end(Buffer.alloc(80 * 1024, 1))
      return
    }
    if (request.url === '/bad-range') {
      response.writeHead(206, { 'content-type': 'audio/mpeg', 'content-range': 'bytes 1-4/5' }).end(Buffer.alloc(4))
      return
    }
    if (request.url === '/bad-range-total') {
      response.writeHead(206, { 'content-type': 'audio/mpeg', 'content-length': 4, 'content-range': 'bytes 0-9/4' }).end(Buffer.from([0x49, 0x44, 0x33, 0]))
      return
    }
    if (request.url === '/bad-range-length') {
      response.writeHead(206, { 'content-type': 'audio/mpeg', 'content-length': 3, 'content-range': 'bytes 0-3/4' }).end(Buffer.from([0x49, 0x44, 0x33]))
      return
    }
    if (request.url === '/spoofed-audio') {
      response.writeHead(200, { 'content-type': 'audio/mpeg' }).end('<html>upstream error</html>')
      return
    }
    if (request.url === '/html') {
      response.writeHead(200, { 'content-type': 'text/html' }).end('<html>error</html>')
      return
    }
    if (request.url === '/empty') {
      response.writeHead(200, { 'content-type': 'audio/mpeg', 'content-length': 0 }).end()
      return
    }
    if (request.url === '/unavailable') {
      response.writeHead(503, { 'content-type': 'text/plain' }).end('offline')
      return
    }
    if (request.url === '/picture') {
      response.writeHead(200, { 'content-type': 'image/png', 'content-length': png.length }).end(png)
      return
    }
    response.writeHead(200, { 'content-type': 'application/json' }).end('{}')
  })
  servers.push(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

afterEach(async() => {
  await Promise.all(servers.splice(0).map(async server => new Promise<void>(resolve => server.close(() => { resolve() }))))
})

describe('bounded media client', () => {
  it('accepts valid ranged audio and caps ignored ranges', async() => {
    const origin = await startFixture()
    const client = new MediaClient({ allowPrivateNetwork: true })

    await expect(client.probeAudio({ url: `${origin}/audio` })).resolves.toBeUndefined()
    await expect(client.probeAudio({ url: `${origin}/ignored-range` })).resolves.toBeUndefined()
  })

  it.each([
    ['/bad-range', 'SOURCE_MEDIA_INVALID'],
    ['/bad-range-total', 'SOURCE_MEDIA_INVALID'],
    ['/bad-range-length', 'SOURCE_MEDIA_INVALID'],
    ['/spoofed-audio', 'SOURCE_MEDIA_INVALID'],
    ['/html', 'SOURCE_MEDIA_INVALID'],
    ['/empty', 'SOURCE_MEDIA_UNAVAILABLE'],
    ['/unavailable', 'SOURCE_MEDIA_UNAVAILABLE'],
  ])('rejects unavailable or invalid audio at %s', async(pathname, code) => {
    const origin = await startFixture()
    const client = new MediaClient({ allowPrivateNetwork: true })

    await expect(client.probeAudio({ url: `${origin}${pathname}` })).rejects.toMatchObject({ code })
  })

  it('fetches validated artwork and rejects non-images', async() => {
    const origin = await startFixture()
    const client = new MediaClient({ allowPrivateNetwork: true })

    await expect(client.fetchArtwork({ url: `${origin}/picture` })).resolves.toMatchObject({ mimeType: 'image/png', bytes: png })
    await expect(client.fetchArtwork({ url: `${origin}/json` })).rejects.toMatchObject({ code: 'SOURCE_MEDIA_INVALID' })
  })

  it('blocks private targets unless explicitly allowed', async() => {
    const origin = await startFixture()
    const client = new MediaClient()

    await expect(client.probeAudio({ url: `${origin}/audio` })).rejects.toMatchObject({ code: 'SOURCE_TARGET_BLOCKED' })
  })
})
