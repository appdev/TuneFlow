import http from 'node:http'
import { afterEach, expect, it, vi } from 'vitest'
import { search, searchCollections } from './index'
import { proxy } from './rendererStoreShim'
import { decodeLyric } from '../../renderer/utils/musicSdk/kw/util'
import musicSdk from '../../renderer/utils/musicSdk'

let server: http.Server | undefined
const originalWindow = (globalThis as { window?: unknown }).window

afterEach(async() => {
  vi.restoreAllMocks()
  proxy.enable = false
  proxy.host = ''
  proxy.port = ''
  ;(globalThis as { window?: unknown }).window = originalWindow
  const currentServer = server
  server = undefined
  if (currentServer != null) await new Promise<void>(resolve => currentServer.close(() => { resolve() }))
})

it('rejects collection results containing an empty identifier', async() => {
  vi.spyOn(musicSdk.kw.songList, 'search').mockResolvedValue({
    list: [{ id: '', name: 'Malformed collection' }],
    total: 1,
    limit: 20,
    source: 'kw',
  })

  await expect(searchCollections('playlist', { source: 'kw', text: 'fixture', page: 1, limit: 20 }))
    .rejects.toMatchObject({ code: 'SOURCE_PROTOCOL_ERROR' })
})

it('executes the bundled KW provider through an HTTP fixture boundary', async() => {
  server = http.createServer((_request, response) => {
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({
      TOTAL: '1',
      SHOW: '1',
      abslist: [{
        MUSICRID: 'MUSIC_fixture-2',
        SONGNAME: 'Fixture provider',
        ARTIST: 'Fixture',
        ALBUMID: 'fixture-album',
        ALBUM: 'Fixture album',
        DURATION: '180',
        N_MINFO: 'level:320k,bitrate:320,format:mp3,size:8m',
      }],
    }))
  })
  server.on('connect', (_request, socket) => {
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
    socket.once('data', () => {
      const body = JSON.stringify({
        TOTAL: '1',
        SHOW: '1',
        abslist: [{
          MUSICRID: 'MUSIC_fixture-2',
          SONGNAME: 'Fixture provider',
          ARTIST: 'Fixture',
          ALBUMID: 'fixture-album',
          ALBUM: 'Fixture album',
          DURATION: '180',
          N_MINFO: 'level:320k,bitrate:320,format:mp3,size:8m',
        }],
      })
      socket.end(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`)
    })
  })
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  proxy.enable = true
  proxy.host = '127.0.0.1'
  proxy.port = String(address.port)
  ;(globalThis as { window?: unknown }).window = {
    DOMParser: class { parseFromString(value: string) { return { body: { textContent: value } } } },
  }

  await expect(search({ source: 'kw', text: 'fixture', page: 2, limit: 20 })).resolves.toMatchObject({
    page: 2,
    source: 'kw',
    total: 1,
    list: [{ songmid: 'fixture-2', name: 'Fixture provider', meta: { _qualitys: { '320k': { size: '8M' } } } }],
  })
})

it('uses the Service lyric decoder when the bundled provider requests native decoding', async() => {
  await expect(decodeLyric({ lrcBase64: Buffer.from('not a lyric').toString('base64'), isGetLyricx: false })).resolves.toBe('')
})
