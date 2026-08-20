import http from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { browsePlaylists, getAlbumDetail, getPlaylistDetail, getPlaylistTags, search, searchCollections, validateAlbumId, validatePlaylistId } from './index'
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

describe('playlist discovery', () => {
  it.each([
    ['kw', { tags: [{ name: '主题', list: [{ id: '2189-10000', name: '短视频' }] }], hotTag: [{ id: '2189-10000', name: '短视频' }], source: 'kw' }],
    ['kg', { tags: [{ name: '语种', list: [{ id: 1, name: '华语' }] }], hotTag: [], source: 'kg' }],
    ['tx', { tags: [{ name: '流派', list: [{ id: 2, name: '流行' }] }], hotTag: [], source: 'tx' }],
    ['wy', { tags: [{ name: '场景', list: [{ id: '夜晚', name: '夜晚' }] }], hotTag: [], source: 'wy' }],
    ['mg', { tags: [{ name: '主题', list: [{ id: '100', name: '经典' }] }], hotTag: [], source: 'mg' }],
  ] as const)('normalizes %s playlist discovery filters', async(source, native) => {
    vi.spyOn(musicSdk[source].songList, 'getTags').mockResolvedValue(native as never)

    await expect(getPlaylistTags(source)).resolves.toMatchObject({
      source,
      groups: [{ name: native.tags[0].name, tags: [{ id: String(native.tags[0].list[0].id), name: native.tags[0].list[0].name }] }],
      hotTags: native.hotTag.map(tag => ({ id: String(tag.id), name: tag.name })),
      sorts: musicSdk[source].songList.sortList.map(sort => ({ id: String(sort.id), name: sort.name })),
    })
  })

  it('normalizes browse metadata without inventing missing fields', async() => {
    vi.spyOn(musicSdk.kw.songList, 'getList').mockResolvedValue({
      list: [{
        id: 'digest-8__3677488020',
        name: 'Fixture playlist',
        author: 'Fixture author',
        total: 41,
        play_count: '450.4万',
        desc: 'Fixture description',
      }, { id: '3677488021', name: 'Minimal playlist' }],
      total: 72,
      limit: 36,
      page: 1,
      source: 'kw',
    })

    await expect(browsePlaylists({ source: 'kw', sortId: 'hot', tagId: '', page: 1 })).resolves.toEqual({
      source: 'kw',
      page: 1,
      limit: 36,
      total: 72,
      hasMore: true,
      list: [expect.objectContaining({
        id: 'digest-8__3677488020',
        kind: 'playlist',
        source: 'kw',
        name: 'Fixture playlist',
        author: 'Fixture author',
        total: 41,
        playCount: '450.4万',
        description: 'Fixture description',
      }), {
        id: '3677488021', kind: 'playlist', name: 'Minimal playlist', source: 'kw',
      }],
    })
  })

  it('normalizes detail metadata and track pages', async() => {
    vi.spyOn(musicSdk.kw.songList, 'getListDetail').mockResolvedValue({
      list: [{ songmid: 'track-1', name: 'Fixture track', singer: 'Fixture artist', interval: 180, source: 'kw' }],
      page: 1,
      limit: 1000,
      total: 41,
      source: 'kw',
      info: { name: 'Fixture playlist', author: 'Fixture author', desc: null, play_count: '450.4万' },
    })

    await expect(getPlaylistDetail({ source: 'kw', playlistId: 'digest-8__3677488020', page: 1 })).resolves.toMatchObject({
      source: 'kw',
      page: 1,
      limit: 1000,
      total: 41,
      hasMore: false,
      playlist: {
        id: 'digest-8__3677488020',
        kind: 'playlist',
        source: 'kw',
        name: 'Fixture playlist',
        author: 'Fixture author',
        total: 41,
        playCount: '450.4万',
      },
      tracks: [{ id: 'track-1', songmid: 'track-1', source: 'kw', interval: '03:00' }],
    })
  })

  it.each([
    'http://127.0.0.1/private',
    'https://example.com/list/1',
    '//example.com/list/1',
    'abc://example',
    '123###secret',
    'line\nbreak',
    'x'.repeat(513),
  ])('rejects unsafe playlist id %j before provider invocation', async(playlistId) => {
    const detail = vi.spyOn(musicSdk.kw.songList, 'getListDetail')
    await expect(getPlaylistDetail({ source: 'kw', playlistId, page: 1 }))
      .rejects.toMatchObject({ code: 'INVALID_PLAYLIST_ID' })
    expect(detail).not.toHaveBeenCalled()
  })

  it.each([
    ['kw', 'digest-8__3677488020'],
    ['kg', 'id_12345'],
    ['tx', '7217720898'],
    ['wy', '3136952023'],
    ['mg', '1000001672'],
  ])('accepts a browse-generated %s playlist id', (source, playlistId) => {
    expect(validatePlaylistId(source, playlistId)).toBe(playlistId)
  })

  it('serializes discovery calls for the same provider', async() => {
    let active = 0
    let maxActive = 0
    let releaseFirst!: () => void
    const firstGate = new Promise<void>(resolve => { releaseFirst = resolve })
    const tags = vi.spyOn(musicSdk.kw.songList, 'getTags')
      .mockImplementationOnce(async() => {
        active++
        maxActive = Math.max(maxActive, active)
        await firstGate
        active--
        return { tags: [], hotTag: [], source: 'kw' }
      })
      .mockImplementationOnce(async() => {
        active++
        maxActive = Math.max(maxActive, active)
        active--
        return { tags: [], hotTag: [], source: 'kw' }
      })

    const first = getPlaylistTags('kw')
    const second = getPlaylistTags('kw')
    await vi.waitFor(() => { expect(tags).toHaveBeenCalledTimes(1) })
    releaseFirst()
    await Promise.all([first, second])

    expect(maxActive).toBe(1)
    expect(tags).toHaveBeenCalledTimes(2)
  })

  it('allows discovery calls for different providers to overlap', async() => {
    let active = 0
    let maxActive = 0
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const implementation = async(source: 'kw' | 'kg') => {
      active++
      maxActive = Math.max(maxActive, active)
      await gate
      active--
      return { tags: [], hotTag: [], source }
    }
    const kw = vi.spyOn(musicSdk.kw.songList, 'getTags').mockImplementation(() => implementation('kw') as never)
    const kg = vi.spyOn(musicSdk.kg.songList, 'getTags').mockImplementation(() => implementation('kg') as never)

    const calls = Promise.all([getPlaylistTags('kw'), getPlaylistTags('kg')])
    await vi.waitFor(() => {
      expect(kw).toHaveBeenCalledTimes(1)
      expect(kg).toHaveBeenCalledTimes(1)
    })
    expect(maxActive).toBe(2)
    release()
    await calls
  })
})

describe('album detail', () => {
  it.each([
    ['wy', '32311'],
    ['kw', '87758985'],
    ['kg', '960399'],
    ['tx', '0024bjiL2aocxT'],
    ['mg', '600927015009000944'],
  ])('accepts a native %s album id', (source, albumId) => {
    expect(validateAlbumId(source, albumId)).toBe(albumId)
  })

  it.each([
    ['wy', 'abc'],
    ['kw', 'https://example.test/album/1'],
    ['kg', '1###secret'],
    ['tx', 'mid_with_punctuation'],
    ['mg', 'line\nbreak'],
    ['wy', '1'.repeat(129)],
  ])('rejects unsafe %s album id %j before provider invocation', async(source, albumId) => {
    const detail = vi.spyOn(musicSdk[source as 'wy'].album, 'getAlbumDetail')
    await expect(getAlbumDetail({ source, albumId, page: 1 }))
      .rejects.toMatchObject({ code: 'INVALID_ALBUM_ID' })
    expect(detail).not.toHaveBeenCalled()
  })

  it('normalizes album metadata, tracks, and pagination', async() => {
    vi.spyOn(musicSdk.kw.album, 'getAlbumDetail').mockResolvedValue({
      list: [{ songmid: 'track-1', name: 'Fixture track', singer: 'Fixture artist', interval: 180, source: 'kw' }],
      page: 1,
      limit: 30,
      total: 31,
      source: 'kw',
      info: {
        name: 'Fixture album',
        author: 'Fixture artist',
        img: null,
        desc: 'Fixture description',
        play_count: '1.2万',
      },
    })

    await expect(getAlbumDetail({ source: 'kw', albumId: '87758985', page: 1 })).resolves.toMatchObject({
      source: 'kw',
      page: 1,
      limit: 30,
      total: 31,
      hasMore: true,
      album: {
        id: '87758985',
        kind: 'album',
        name: 'Fixture album',
        source: 'kw',
        author: 'Fixture artist',
        total: 31,
        img: null,
        description: 'Fixture description',
        playCount: '1.2万',
      },
      tracks: [{
        id: 'track-1',
        songmid: 'track-1',
        name: 'Fixture track',
        singer: 'Fixture artist',
        interval: '03:00',
        source: 'kw',
      }],
    })
  })

  it('rejects album details with missing required metadata', async() => {
    vi.spyOn(musicSdk.kw.album, 'getAlbumDetail').mockResolvedValue({
      list: [],
      page: 1,
      limit: 30,
      total: 0,
      source: 'kw',
      info: {},
    })

    await expect(getAlbumDetail({ source: 'kw', albumId: '87758985', page: 1 }))
      .rejects.toMatchObject({ code: 'SOURCE_PROTOCOL_ERROR' })
  })
})
