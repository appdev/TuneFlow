import { afterEach, describe, expect, it, vi } from 'vitest'
import album from './album'

const { createHttpFetch, getMusicInfosByList } = vi.hoisted(() => ({
  createHttpFetch: vi.fn(),
  getMusicInfosByList: vi.fn(),
}))
vi.mock('./util', () => ({ createHttpFetch }))
vi.mock('./musicInfo', () => ({ getMusicInfosByList }))

afterEach(() => {
  createHttpFetch.mockReset()
  getMusicInfosByList.mockReset()
})

describe('Kugou album detail', () => {
  it('combines paged album songs with album metadata', async() => {
    createHttpFetch.mockImplementation(async(url: string) => url.includes('/album/song')
      ? { total: 1, info: [{ hash: 'fixture-hash' }] }
      : [{
          album_name: '魔杰座',
          sizable_cover: 'https://example.test/{size}.jpg',
          intro: 'Fixture description',
          author_name: '周杰伦',
        }])
    getMusicInfosByList.mockResolvedValue([{ songmid: 'track-1', source: 'kg' }])

    await expect(album.getAlbumDetail('960399', 2, 30)).resolves.toEqual({
      list: [{ songmid: 'track-1', source: 'kg' }],
      page: 2,
      limit: 30,
      total: 1,
      source: 'kg',
      info: {
        name: '魔杰座',
        img: 'https://example.test/240.jpg',
        desc: 'Fixture description',
        author: '周杰伦',
      },
    })
    expect(createHttpFetch.mock.calls[0][0]).toContain('page=2')
    expect(createHttpFetch.mock.calls[0][0]).toContain('pagesize=30')
  })
})
