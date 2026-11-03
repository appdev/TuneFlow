import { afterEach, describe, expect, it, vi } from 'vitest'
import albumSearch from './albumSearch'

const { httpFetch } = vi.hoisted(() => ({ httpFetch: vi.fn() }))
vi.mock('../../request', () => ({ httpFetch }))

afterEach(() => {
  httpFetch.mockReset()
  vi.restoreAllMocks()
})

describe('Migu album search', () => {
  it('enables only album search and normalizes v3 results', async() => {
    vi.spyOn(Date, 'now').mockReturnValue(1_787_200_000_000)
    httpFetch.mockReturnValue({
      promise: Promise.resolve({
        body: {
          code: '000000',
          albumResultData: {
            totalCount: '41',
            result: [{
              id: '600927015009000944',
              name: '最伟大的作品',
              singer: '周杰伦',
              desc: '2022-07-15',
              imgItems: [{ img: 'https://example.test/album.jpg' }],
            }],
          },
        },
      }),
    })

    await expect(albumSearch.search('周杰伦', 2, 20)).resolves.toEqual({
      list: [{
        id: '600927015009000944',
        name: '最伟大的作品',
        author: '周杰伦',
        img: 'https://example.test/album.jpg',
        desc: '2022-07-15',
        source: 'mg',
      }],
      total: 41,
      limit: 20,
      source: 'mg',
    })
    const url = new URL(httpFetch.mock.calls[0][0] as string)
    expect(JSON.parse(url.searchParams.get('searchSwitch')!)).toMatchObject({ song: 0, album: 1 })
    expect(url.searchParams.get('pageNo')).toBe('2')
    expect(httpFetch.mock.calls[0][1].headers).toMatchObject({
      timestamp: '1787200000000', deviceId: expect.any(String), sign: expect.any(String),
    })
  })
})
