import { afterEach, describe, expect, it, vi } from 'vitest'
import albumSearch from './albumSearch'

const { eapiRequest } = vi.hoisted(() => ({ eapiRequest: vi.fn() }))
vi.mock('./utils/index', () => ({ eapiRequest }))

afterEach(() => { eapiRequest.mockReset() })

describe('NetEase album search', () => {
  it('uses cloud-search album type and offset pagination', async() => {
    eapiRequest.mockReturnValue({
      promise: Promise.resolve({
        body: {
          code: 200,
          result: {
            albumCount: 1,
            albums: [{
              id: 32311,
              name: '叶惠美',
              size: 11,
              picUrl: 'https://example.test/album.jpg',
              artists: [{ name: '周杰伦' }],
            }],
          },
        },
      }),
    })

    await expect(albumSearch.search('周杰伦', 2, 20)).resolves.toMatchObject({
      total: 1,
      limit: 20,
      source: 'wy',
      list: [{ id: '32311', name: '叶惠美', author: '周杰伦', total: 11 }],
    })
    expect(eapiRequest).toHaveBeenCalledWith('/api/cloudsearch/pc', {
      s: '周杰伦', type: 10, limit: 20, total: false, offset: 20,
    })
  })
})
