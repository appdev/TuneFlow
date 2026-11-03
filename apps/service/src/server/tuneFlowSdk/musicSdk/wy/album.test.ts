import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import album from './album'

const { eapiRequest } = vi.hoisted(() => ({ eapiRequest: vi.fn() }))
vi.mock('./utils/index', () => ({ eapiRequest }))

const originalWindow = (globalThis as { window?: unknown }).window

beforeEach(() => {
  ;(globalThis as { window?: unknown }).window = {
    DOMParser: class { parseFromString(value: string) { return { body: { textContent: value } } } },
  }
})

afterEach(() => {
  eapiRequest.mockReset()
  ;(globalThis as { window?: unknown }).window = originalWindow
})

const song = (id: number) => ({
  id,
  name: `Track ${id}`,
  dt: 180000,
  ar: [{ name: '周杰伦' }],
  al: { id: 32311, name: '叶惠美' },
  l: { size: 1024 },
  h: { size: 2048 },
  sq: { size: 4096 },
  privilege: { chargeInfoList: [] },
})

describe('NetEase album detail', () => {
  it('normalizes and slices the requested album page', async() => {
    eapiRequest.mockReturnValue({
      promise: Promise.resolve({
        body: {
          code: 200,
          album: {
            id: 32311,
            name: '叶惠美',
            size: 101,
            picUrl: 'https://example.test/album.jpg',
            description: 'Fixture description',
            artists: [{ name: '周杰伦' }],
          },
          songs: Array.from({ length: 101 }, (_, index) => song(index + 1)),
        },
      }),
    })

    await expect(album.getAlbumDetail('32311', 2)).resolves.toMatchObject({
      page: 2,
      limit: 100,
      total: 101,
      source: 'wy',
      info: {
        name: '叶惠美',
        img: 'https://example.test/album.jpg',
        desc: 'Fixture description',
        author: '周杰伦',
      },
      list: [{ songmid: 101, name: 'Track 101', source: 'wy', interval: '03:00' }],
    })
    expect(eapiRequest).toHaveBeenCalledWith('/api/v1/album/32311', {})
  })
})
