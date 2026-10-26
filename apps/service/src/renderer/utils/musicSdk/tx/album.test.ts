import { afterEach, describe, expect, it, vi } from 'vitest'
import album from './album'

const { httpFetch } = vi.hoisted(() => ({ httpFetch: vi.fn() }))
vi.mock('../../request', () => ({ httpFetch }))

const track = {
  id: 718477,
  mid: '001zMQr71F1Qo8',
  title: '夜曲',
  interval: 226,
  singer: [{ mid: '0025NhlN2yWrP4', name: '周杰伦' }],
  album: { id: 60671, mid: '0024bjiL2aocxT', name: '十一月的萧邦' },
  file: { media_mid: '0024jrso28p8VA', size_128mp3: 3630591, size_320mp3: 0, size_flac: 0, size_hires: 0 },
}

afterEach(() => { httpFetch.mockReset() })

describe('QQ Music album detail', () => {
  it('requests a true album page and derives metadata from its tracks', async() => {
    httpFetch.mockReturnValue({
      promise: Promise.resolve({
        body: {
          code: 0,
          albumSonglist: {
            code: 0,
            data: {
              albumMid: '0024bjiL2aocxT', totalNum: 12, songList: [{ songInfo: track }],
            },
          },
        },
      }),
    })

    await expect(album.getAlbumDetail('0024bjiL2aocxT', 2)).resolves.toMatchObject({
      page: 2,
      limit: 100,
      total: 12,
      source: 'tx',
      info: {
        name: '十一月的萧邦',
        author: '周杰伦',
        img: 'https://y.gtimg.cn/music/photo_new/T002R500x500M0000024bjiL2aocxT.jpg',
      },
      list: [{ songmid: '001zMQr71F1Qo8', name: '夜曲', singer: '周杰伦', source: 'tx' }],
    })
    expect(httpFetch).toHaveBeenCalledWith('https://u.y.qq.com/cgi-bin/musicu.fcg', expect.objectContaining({
      method: 'post',
      body: expect.objectContaining({
        albumSonglist: expect.objectContaining({
          module: 'music.musichallAlbum.AlbumSongList',
          method: 'GetAlbumSongList',
          param: { albumMid: '0024bjiL2aocxT', albumID: 0, begin: 100, num: 100, order: 2 },
        }),
      }),
    }))
  })
})
