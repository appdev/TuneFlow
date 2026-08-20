import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import album from './album'

const { httpFetch } = vi.hoisted(() => ({ httpFetch: vi.fn() }))

vi.mock('../../request', () => ({ httpFetch }))

const originalWindow = (globalThis as { window?: unknown }).window

describe('Kuwo album detail', () => {
  beforeEach(() => {
    ;(globalThis as { window?: unknown }).window = {
      DOMParser: class { parseFromString(value: string) { return { body: { textContent: value } } } },
    }
    httpFetch.mockReturnValue({
      promise: Promise.resolve({
        statusCode: 200,
        body: "{'name':'太阳之子','albumid':'87758985','songnum':'1','img':'https://example.test/album.jpg','info':'Fixture description','artist':'周杰伦','musiclist':[{'formats':'MP3128|MP3H','artist':'周杰伦','name':'Fixture track','id':'123','duration':'297','pic':'https://example.test/track.jpg'}]}",
      }),
    })
  })

  afterEach(() => {
    httpFetch.mockReset()
    ;(globalThis as { window?: unknown }).window = originalWindow
  })

  it('exposes paged legacy album tracks through the common detail method', async() => {
    await expect(album.getAlbumDetail('87758985', 2)).resolves.toEqual({
      list: [expect.objectContaining({
        songmid: '123',
        albumId: '87758985',
        albumName: '太阳之子',
        name: 'Fixture track',
        singer: '周杰伦',
        source: 'kw',
        interval: '04:57',
        types: [{ type: '128k', size: null }, { type: '320k', size: null }],
      })],
      page: 2,
      limit: 1000,
      total: 1,
      source: 'kw',
      info: {
        name: '太阳之子',
        img: 'https://example.test/album.jpg',
        desc: 'Fixture description',
        author: '周杰伦',
      },
    })

    expect(httpFetch.mock.calls[0][0]).toContain('pn=1')
  })
})
