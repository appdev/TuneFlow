import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import songList from './songList'

const { httpFetch } = vi.hoisted(() => ({ httpFetch: vi.fn() }))

vi.mock('../../request', () => ({ httpFetch }))

const originalWindow = (globalThis as { window?: unknown }).window

const track = {
  id: 101,
  mid: 'track-mid-1',
  title: 'Fixture track',
  interval: 180,
  singer: [{ mid: 'artist-mid-1', name: 'Fixture artist' }],
  album: { mid: 'album-mid-1', name: 'Fixture album' },
  file: {
    media_mid: 'media-mid-1',
    size_128mp3: 1024,
    size_320mp3: 0,
    size_flac: 0,
    size_hires: 0,
  },
}

const response = (overrides: Record<string, unknown> = {}) => ({
  code: 0,
  req: {
    code: 0,
    data: {
      dirinfo: {
        title: 'Fixture playlist',
        picurl: 'https://example.test/playlist.jpg',
        desc: 'Fixture &amp; description',
        creator: { nick: 'Fixture creator' },
        listennum: 45678,
        songnum: 250,
      },
      songlist: [track],
      total_song_num: 250,
      hasmore: 1,
    },
  },
  ...overrides,
})

describe('TX playlist detail adapter', () => {
  beforeEach(() => {
    ;(globalThis as { window?: unknown }).window = {
      DOMParser: class { parseFromString(value: string) { return { body: { textContent: value.replace('&amp;', '&') } } } },
    }
  })

  afterEach(() => {
    httpFetch.mockReset()
    ;(globalThis as { window?: unknown }).window = originalWindow
  })

  it('uses the uniform detail POST endpoint with true page offsets', async() => {
    httpFetch.mockReturnValue({ promise: Promise.resolve({ body: response() }) })

    await expect(songList.getListDetail('7707261125', 2)).resolves.toEqual({
      list: [expect.objectContaining({ songmid: 'track-mid-1', name: 'Fixture track', singer: 'Fixture artist' })],
      page: 2,
      limit: 100,
      total: 250,
      source: 'tx',
      info: {
        name: 'Fixture playlist',
        img: 'https://example.test/playlist.jpg',
        desc: 'Fixture & description',
        author: 'Fixture creator',
        play_count: '4.5万',
      },
    })
    expect(httpFetch).toHaveBeenCalledOnce()
    expect(httpFetch).toHaveBeenCalledWith('https://u.y.qq.com/cgi-bin/musicu.fcg', expect.objectContaining({
      method: 'post',
      body: {
        comm: expect.any(Object),
        req: {
          module: 'music.srfDissInfo.aiDissInfo',
          method: 'uniform_get_Dissinfo',
          param: {
            disstid: 7707261125,
            enc_host_uin: '',
            tag: 1,
            userinfo: 1,
            song_begin: 100,
            song_num: 100,
          },
        },
      },
    }))
  })

  it('defaults omitted legacy page arguments to the first page', async() => {
    const body = response()
    body.req.data.dirinfo.creator = undefined as never
    body.req.data.dirinfo.host_nick = 'Fallback creator'
    httpFetch.mockReturnValue({ promise: Promise.resolve({ body }) })

    await expect(songList.getListDetail('7707261125')).resolves.toMatchObject({
      page: 1,
      info: { author: 'Fallback creator' },
    })
    expect(httpFetch).toHaveBeenCalledWith('https://u.y.qq.com/cgi-bin/musicu.fcg', expect.objectContaining({
      body: expect.objectContaining({
        req: expect.objectContaining({
          param: expect.objectContaining({ song_begin: 0, song_num: 100 }),
        }),
      }),
    }))
  })

  it.each([
    'https://y.qq.com/n/ryqq/playlist/7707261125',
    '7707261125x',
    '9007199254740992',
    '0',
  ])('rejects non-safe numeric playlist id %j before network access', async(id) => {
    await expect(songList.getListDetail(id, 1)).rejects.toThrow('Invalid TX playlist id')
    expect(httpFetch).not.toHaveBeenCalled()
  })

  it.each([
    { code: 1, req: { code: 0, data: response().req.data } },
    { code: 0, req: { code: 1, data: response().req.data } },
    { code: 0, req: { code: 0, data: { ...response().req.data, dirinfo: null } } },
    { code: 0, req: { code: 0, data: { ...response().req.data, songlist: null } } },
  ])('rejects malformed uniform detail responses', async(body) => {
    httpFetch.mockReturnValue({ promise: Promise.resolve({ body }) })

    await expect(songList.getListDetail('7707261125', 1)).rejects.toThrow('Invalid TX playlist detail response')
  })
})
