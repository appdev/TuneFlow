import { afterEach, describe, expect, it, vi } from 'vitest'
import albumSearch from './albumSearch'

const { signRequest } = vi.hoisted(() => ({ signRequest: vi.fn() }))
vi.mock('./utils', () => ({ signRequest }))

afterEach(() => { signRequest.mockReset() })

describe('QQ Music album search', () => {
  it('uses signed desktop album search and normalizes album MIDs', async() => {
    signRequest.mockResolvedValue({
      body: {
        code: 0,
        'music.search.SearchCgiService': {
          code: 0,
          data: {
            body: {
              album: {
                list: [{
                  albumMID: '0024bjiL2aocxT',
                  albumName: '十一月的萧邦',
                  albumPic: 'https://example.test/album.jpg',
                  singerName: '周杰伦',
                  song_count: 12,
                }],
              },
            },
            meta: { sum: 496 },
          },
        },
      },
    })

    await expect(albumSearch.search('周杰伦', 2, 20)).resolves.toEqual({
      list: [{
        id: '0024bjiL2aocxT',
        name: '十一月的萧邦',
        author: '周杰伦',
        total: 12,
        img: 'https://example.test/album.jpg',
        source: 'tx',
      }],
      total: 496,
      limit: 20,
      source: 'tx',
    })
    expect(signRequest).toHaveBeenCalledWith(expect.objectContaining({
      'music.search.SearchCgiService': expect.objectContaining({
        method: 'DoSearchForQQMusicDesktop',
        param: expect.objectContaining({ query: '周杰伦', search_type: 2, page_num: 2, num_per_page: 20 }),
      }),
    }))
  })
})
