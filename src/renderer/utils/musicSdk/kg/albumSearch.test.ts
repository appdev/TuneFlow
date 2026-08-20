import { afterEach, describe, expect, it, vi } from 'vitest'
import albumSearch from './albumSearch'

const { httpFetch } = vi.hoisted(() => ({ httpFetch: vi.fn() }))
vi.mock('../../request', () => ({ httpFetch }))

afterEach(() => { httpFetch.mockReset() })

describe('Kugou album search', () => {
  it('normalizes native album results and cover templates', async() => {
    httpFetch.mockReturnValue({
      promise: Promise.resolve({
        body: {
          status: 1,
          errcode: 0,
          data: {
            total: 500,
            info: [{
              albumid: 960399,
              albumname: '魔杰座',
              singername: '周杰伦',
              songcount: 11,
              imgurl: 'http://imge.kugou.com/stdmusic/{size}/fixture.jpg',
              intro: 'Fixture description',
            }],
          },
        },
      }),
    })

    await expect(albumSearch.search('周杰伦', 2, 30)).resolves.toEqual({
      list: [{
        id: '960399',
        name: '魔杰座',
        author: '周杰伦',
        total: 11,
        img: 'http://imge.kugou.com/stdmusic/400/fixture.jpg',
        desc: 'Fixture description',
        source: 'kg',
      }],
      total: 500,
      limit: 30,
      source: 'kg',
    })
    const url = httpFetch.mock.calls[0][0] as string
    expect(url).toContain('/api/v3/search/album?')
    expect(url).toContain('page=2')
    expect(url).toContain('pagesize=30')
  })

  it('rejects unsuccessful native responses', async() => {
    httpFetch.mockReturnValue({ promise: Promise.resolve({ body: { status: 0, errcode: 1 } }) })
    await expect(albumSearch.search('周杰伦', 1, 30)).rejects.toThrow('Album search failed')
  })
})
