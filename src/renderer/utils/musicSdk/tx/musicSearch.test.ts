import { beforeEach, describe, expect, it, vi } from 'vitest'
import musicSearch from './musicSearch'

const { httpFetch } = vi.hoisted(() => ({ httpFetch: vi.fn() }))

vi.mock('../../request', () => ({ httpFetch }))

describe('QQ Music track search', () => {
  beforeEach(() => {
    httpFetch.mockReset()
    httpFetch.mockReturnValue({
      promise: Promise.resolve({
        body: {
          code: 0,
          'music.search.SearchCgiService': {
            code: 0,
            data: {
              body: {
                song: {
                  list: [{
                    id: 575196994,
                    mid: '003tVOQf29pSu7',
                    title: '亲爱的你啊',
                    interval: 235,
                    singer: [{ mid: '001GAeOa0SeDvI', name: '任素汐' }],
                    album: { mid: '003AfRtY31zLzR', name: '亲爱的你啊' },
                    file: {
                      media_mid: '003tVOQf29pSu7',
                      size_128mp3: 3_773_119,
                      size_320mp3: 9_432_496,
                      size_flac: 44_015_025,
                      size_hires: 0,
                    },
                  }],
                },
              },
              meta: { sum: 1 },
            },
          },
        },
      }),
    })
  })

  it('searches with the current desktop protocol and normalizes its response', async() => {
    await expect(musicSearch.search('任素汐', 1, 30)).resolves.toMatchObject({
      source: 'tx',
      total: 1,
      limit: 30,
      list: [{
        songmid: '003tVOQf29pSu7',
        name: '亲爱的你啊',
        singer: '任素汐',
        interval: '03:55',
      }],
    })

    expect(httpFetch).toHaveBeenCalledOnce()
    expect(httpFetch).toHaveBeenCalledWith(expect.stringContaining('/cgi-bin/musics.fcg?sign='), expect.objectContaining({
      method: 'post',
      body: expect.objectContaining({
        comm: expect.objectContaining({ ct: '19', cv: '2151' }),
        'music.search.SearchCgiService': expect.objectContaining({
          method: 'DoSearchForQQMusicDesktop',
          param: expect.objectContaining({ query: '任素汐', page_num: 1, num_per_page: 30 }),
        }),
      }),
    }))
  })
})
