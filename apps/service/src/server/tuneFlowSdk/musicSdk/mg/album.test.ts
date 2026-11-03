import { afterEach, describe, expect, it, vi } from 'vitest'
import album from './album'

const { createHttpFetch, filterMusicInfoListV5 } = vi.hoisted(() => ({
  createHttpFetch: vi.fn(), filterMusicInfoListV5: vi.fn(),
}))
vi.mock('./utils', () => ({ createHttpFetch }))
vi.mock('./musicInfo', () => ({ filterMusicInfoListV5 }))

afterEach(() => {
  createHttpFetch.mockReset()
  filterMusicInfoListV5.mockReset()
})

describe('Migu album detail', () => {
  it('combines current v3 album songs with metadata', async() => {
    createHttpFetch.mockImplementation(async(url: string) => url.includes('/album/song/v2.0')
      ? { songList: [{ songId: 'track-1' }], totalCount: 1 }
      : {
          title: '最伟大的作品',
          imgItems: [{ img: 'https://example.test/album.jpg' }],
          summary: 'Fixture description',
          singer: '周杰伦',
          totalCount: 1,
          opNumItem: { playNum: 123 },
        })
    filterMusicInfoListV5.mockReturnValue([{ songmid: 'track-1', source: 'mg' }])

    await expect(album.getAlbumDetail('600927015009000944', 2)).resolves.toEqual({
      list: [{ songmid: 'track-1', source: 'mg' }],
      page: 2,
      limit: 50,
      total: 1,
      source: 'mg',
      info: {
        name: '最伟大的作品',
        img: 'https://example.test/album.jpg',
        desc: 'Fixture description',
        author: '周杰伦',
        play_count: '123',
      },
    })
    expect(createHttpFetch.mock.calls.map(([url]) => url)).toEqual(expect.arrayContaining([
      expect.stringContaining('pageNo=2'),
      expect.stringContaining('/MIGUM3.0/resource/album/song/v2.0'),
      expect.stringContaining('/resource/album/v2.0'),
    ]))
  })

  it('resolves a digital album id through its material album id', async() => {
    createHttpFetch.mockImplementation(async(url: string) => {
      if (url.includes('resourceinfo.do')) return { resource: [{ materialId: '1139605801' }] }
      if (url.includes('/album/song/v2.0')) return { songList: [{ songId: 'track-1' }], totalCount: 1 }
      if (url.includes('albumId=600927015009000944')) return null
      return {
        title: '最伟大的作品',
        imgItems: [],
        summary: null,
        singer: '周杰伦',
        totalCount: 1,
        opNumItem: { playNum: 0 },
      }
    })
    filterMusicInfoListV5.mockReturnValue([{ songmid: 'track-1', source: 'mg' }])

    await expect(album.getAlbumDetail('600927015009000944')).resolves.toMatchObject({
      total: 1,
      list: [{ songmid: 'track-1', source: 'mg' }],
      info: { name: '最伟大的作品', author: '周杰伦' },
    })
    expect(createHttpFetch.mock.calls.map(([url]) => url)).toEqual(expect.arrayContaining([
      expect.stringContaining('resourceType=5&resourceId=600927015009000944'),
      expect.stringContaining('albumId=1139605801'),
    ]))
  })
})
